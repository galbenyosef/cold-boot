"""OmniVoice (TTS) + Parakeet (ASR) on MLX.

Adapted from tities `engine/tities_engine/synth.py` + `voices.py`. The CLI is a single
process doing one thing at a time, so every model call already runs on one thread
(MLX keeps per-thread streams — never call the models from another thread). The
generator also takes a file lock (`voice/.lock`) so two generation processes never
run at once.

Quality knobs (from tities, measured there 2026-11-10 on 10 PL/EN sentences × seeds,
scored with Parakeet — re-measure before changing them):
  DURATION_FACTOR 1.0  mlx-audio pads its duration estimate ×1.15; with that much room OmniVoice
                       fills it with drawn-out words and insertions (~1.7× more word errors: 31 vs
                       18 over 63 takes). ×0.9 was worse again. The model fills exactly the length
                       it is given, so the length is passed explicitly.
  MAX_ERRORS 0         any insertion, missing word or stumble → another take (within `tries`).
  GAP_MAX 1.0 s        a silence longer than this inside a sentence counts as a stumble.
  STABLE guidance 3.0  "stable pronunciation" (default 2.0): sticks closer to the text. Helped in one
                       round, neutral in another → per-character opt-in (`stable: true`).
  position_temperature stays at the default 5.0 (lower was measured worse).
"""

from __future__ import annotations

import re
import zlib
from dataclasses import dataclass, field

import numpy as np

from .align import align, asr_tokens, norm_word, text_words
from .audio import (HOP, SR, TARGET_RMS, fade, frame_rms, loudness_gain, mp3_roundtrip, onset_click,
                    silence_threshold, trim_silence)

MODEL_ID = "mlx-community/OmniVoice-bfloat16"
ASR_ID = "mlx-community/parakeet-tdt-0.6b-v3"

DURATION_FACTOR = 1.0
MAX_ERRORS = 0
GAP_MAX = 1.0
STABLE = {"guidance_scale": 3.0}
NUM_STEPS = 32  # tities' design uses 32; offline we can always afford the full schedule
DEFAULT_TRIES = 5  # tities uses 2–3 (real time); offline generation can afford more
REF_MAX_S = 10.0  # OmniVoice clips the reference to 10 s

KNOB_DEFAULTS = {"steps": NUM_STEPS, "tries": DEFAULT_TRIES, "stable": False, "speed": 1.0}
GLOBAL_KNOBS = {"DURATION_FACTOR": DURATION_FACTOR, "MAX_ERRORS": MAX_ERRORS, "GAP_MAX": GAP_MAX,
                "STABLE": STABLE, "TARGET_RMS": TARGET_RMS, "MODEL": MODEL_ID}


@dataclass
class Take:
    audio: np.ndarray
    ok: bool
    score: float
    ratio: float
    missing: int
    extra: int
    stalls: int
    transcript: str
    seed: int
    tries: int = 1
    info: str = ""
    history: list = field(default_factory=list)


def sentence_starts(text: str) -> set[int]:
    """Indices (in text_words(text)) of words that begin a sentence / clause after
    strong punctuation — a long pause there is delivery, not a stumble."""
    starts, k, brk = {0}, 0, False
    for tok in re.sub(r"\[[a-z-]+\]", " ", text).split():
        n = text_words(tok)
        if not n:
            brk = True  # "—", "...", "-"
            continue
        if brk:
            starts.add(k)
        k += len(n)
        brk = bool(re.search(r"[.?!…:;—]|\.\.\.$|-$", tok))
    return starts


def line_seed(base: int, key: str, attempt: int) -> int:
    return (base * 100003 + zlib.crc32(key.encode()) + 1000 * attempt) % (2**31 - 1)


class Engine:
    def __init__(self, log=print) -> None:
        self.log = log
        self.model = None
        self.asr = None
        self.durations = None
        self._tok: dict[str, object] = {}

    # ── loading (lazy: `check` only needs ASR)
    def tts(self):
        if self.model is None:
            from mlx_audio.tts.models.omnivoice.duration import RuleDurationEstimator
            from mlx_audio.tts.utils import load_model

            self.log("loading OmniVoice …")
            self.model = load_model(MODEL_ID)
            self.durations = RuleDurationEstimator()
        return self.model

    def stt(self):
        if self.asr is None:
            from mlx_audio.stt import load as stt_load

            self.log("loading Parakeet …")
            self.asr = stt_load(ASR_ID)
        return self.asr

    # ── primitives
    def duration(self, text: str, speed: float = 1.0) -> float:
        """Length of audio the model fills (see DURATION_FACTOR)."""
        self.tts()
        raw = self.durations.estimate_duration(text, "Nice to meet you.", 25)  # same rate as mlx-audio
        return max(10, int(raw * DURATION_FACTOR / max(0.5, speed))) / 25  # 25 audio tokens per second

    def ref_tokens(self, key: str, wav: np.ndarray):
        import mlx.core as mx

        if key not in self._tok:
            w = wav[: int(SR * REF_MAX_S)]
            t = self.tts().audio_tokenizer.encode(mx.array(w)[None, :, None])[0]
            mx.eval(t)
            self._tok[key] = t
        return self._tok[key]

    def asr_words(self, audio: np.ndarray) -> list[tuple[str, float, float]]:
        """[(normalized word, start, end)] with digits spelled out."""
        import mlx.core as mx
        from scipy.signal import resample_poly

        res = self.stt().generate(mx.array(resample_poly(audio, 2, 3).astype(np.float32)))
        ws: list[list] = []
        for sent in res.sentences:
            for tk in sent.tokens:
                if not ws or tk.text.startswith(" "):
                    ws.append([tk.text, tk.start, tk.end])
                else:
                    ws[-1][0] += tk.text
                    ws[-1][2] = tk.end
        out = []
        for w, t0, t1 in ws:
            for n in asr_tokens([w]):
                out.append((n, t0, t1))
        return out

    def transcribe(self, audio: np.ndarray) -> str:
        import mlx.core as mx
        from scipy.signal import resample_poly

        return self.stt().generate(mx.array(resample_poly(audio, 2, 3).astype(np.float32))).text.strip()

    def score(self, audio: np.ndarray, text: str) -> dict:
        """ASR check of finished audio against the text it should contain."""
        hyp = self.asr_words(audio)
        ref = text_words(text)
        al = align(ref, [h[0] for h in hyp])
        ratio = sum(x is not None for x in al.map) / max(1, len(ref))
        stalls = self._stalls(al.map, hyp, sentence_starts(text))
        errors = al.errors + stalls
        return {"ok": ratio >= 0.6 and errors <= MAX_ERRORS, "score": round(ratio - 0.1 * errors, 3),
                "ratio": round(ratio, 3), "missing": al.missing, "extra": al.extra, "stalls": stalls,
                "transcript": " ".join(h[0] for h in hyp)}

    @staticmethod
    def _stalls(m, hyp, starts) -> int:
        n, prev = 0, None
        for j, h in enumerate(m):
            if h is None:
                continue
            if prev is not None and j not in starts and hyp[h][1] - hyp[prev][2] > GAP_MAX:
                n += 1
            prev = h
        return n

    # ── voice design (tities voices.design, English, returns audio instead of writing the store)
    def design(self, instruct: str, seed: int, ref_text: str, language: str = "en") -> np.ndarray:
        import mlx.core as mx

        model = self.tts()
        mx.random.seed(seed)
        r = next(model.generate(text=ref_text, language=language, instruct=instruct or "None",
                                num_steps=NUM_STEPS, duration_s=self.duration(ref_text)))
        a = trim_silence(np.array(r.audio, dtype=np.float32).reshape(-1))
        rms = frame_rms(a)
        click = onset_click(rms, silence_threshold(rms)) if len(rms) else 0
        if click:
            a = a[max(0, click * HOP - 1920):].copy()
        a *= loudness_gain(a)
        return a

    # ── one line, cloned from a reference, with the ASR quality gate
    def render(self, text: str, ref_key: str, ref_wav: np.ndarray, ref_text: str, *, seed: int,
               key: str, knobs: dict, language: str = "en", target_rms: float = TARGET_RMS) -> Take:
        import mlx.core as mx

        model = self.tts()
        tokens = self.ref_tokens(ref_key, ref_wav)
        tries = int(knobs.get("tries", DEFAULT_TRIES))
        extra = STABLE if knobs.get("stable") else {}
        best: Take | None = None
        history = []
        for attempt in range(tries):
            s = line_seed(seed, key, attempt)
            mx.random.seed(s)
            r = next(model.generate(
                text=text, language=language, num_steps=int(knobs.get("steps", NUM_STEPS)),
                ref_tokens=tokens, ref_text=ref_text,
                duration_s=self.duration(text, float(knobs.get("speed", 1.0))), **extra,
            ))
            raw = np.array(r.audio, dtype=np.float32).reshape(-1)
            t = self._finish(raw, text, s, target_rms)
            history.append({"seed": s, "score": t.score, "info": t.info})
            if best is None or t.score > best.score:
                best = t
            if best.ok:
                break
        assert best is not None
        best.tries = len(history)
        best.history = history
        return best

    def _finish(self, raw: np.ndarray, text: str, seed: int, target_rms: float) -> Take:
        """Trim (onset click, leading/trailing silence, junk tail), fades, loudness; score with ASR."""
        rms = frame_rms(raw)
        if len(rms) < 4:
            return Take(np.zeros(int(0.3 * SR), np.float32), False, -9, 0, 0, 0, 0, "", seed, info="empty")
        thr = silence_threshold(rms)
        voiced = np.nonzero(rms > thr)[0]
        if len(voiced) == 0:
            return Take(np.zeros(int(0.3 * SR), np.float32), False, -9, 0, 0, 0, 0, "", seed, info="silent")
        hyp = self.asr_words(raw)
        ref = text_words(text)
        al = align(ref, [h[0] for h in hyp])
        ratio = sum(x is not None for x in al.map) / max(1, len(ref))
        stalls = self._stalls(al.map, hyp, sentence_starts(text))
        errors = al.errors + stalls

        click = onset_click(rms, thr, hyp[0][1] if hyp else None)
        # 30 ms pre-roll; 80 ms after a cut-off onset burst, so a soft first consonant survives
        s0 = max(0, click * HOP - 1920) if click else max(0, int(voiced[0]) * HOP - 720)
        cut = min(len(raw), (int(voiced[-1]) + 12) * HOP)
        # junk tail: sound long after the last word ASR matched → cut at the first pause after it
        junk = False
        matched = [h for h in al.map if h is not None]
        if matched:
            t_end = hyp[max(matched)][2]
            if cut / SR > t_end + 0.8:
                quiet = rms < max(thr, float(np.percentile(rms, 90)) * 0.056)
                f = int((t_end - 0.05) * 100)
                while f < len(quiet) - 8 and not quiet[f : f + 8].all():
                    f += 1
                if f < len(quiet) - 8 and f * HOP < cut:
                    cut = (f + 6) * HOP
                    junk = True
        x = raw[s0:cut].astype(np.float32).copy()
        fade(x, min(240, len(x) // 4), min(1200, len(x) // 4))
        x *= loudness_gain(x, target_rms)
        peak = float(np.abs(x).max()) if len(x) else 0.0
        if peak > 0.97:
            x *= 0.97 / peak
        if True:  # score what ships: the trimmed take after an mp3 round trip
            sc = self.score(mp3_roundtrip(x), text)
            ratio, errors = sc["ratio"], sc["missing"] + sc["extra"] + sc["stalls"]
            al.missing, al.extra, stalls = sc["missing"], sc["extra"], sc["stalls"]
            transcript = sc["transcript"]
        else:
            transcript = " ".join(h[0] for h in hyp)
        ok = ratio >= 0.6 and errors <= MAX_ERRORS
        score = round(ratio - 0.1 * errors - (0.02 if junk else 0), 3)
        info = (f"match={ratio:.2f} miss={al.missing} extra={al.extra} stall={stalls}"
                f"{' tail-cut' if junk else ''} audio={len(x) / SR:.2f}s")
        return Take(x, ok, score, round(ratio, 3), al.missing, al.extra, stalls, transcript, seed, info=info)
