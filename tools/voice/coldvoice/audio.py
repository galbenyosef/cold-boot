"""Audio DSP.

Copied from tities (`engine/tities_engine/audio.py`): silence detection, trim, fades,
loudness, room tone, WSOLA, the OmniVoice onset-click detector. Added for COLD BOOT:
reference-clip transforms for voice variants (LPC whisper, pitch, pace), simple pitch /
voicing analysis (used by auditions instead of ears) and ffmpeg mp3 I/O.
"""

from __future__ import annotations

import shutil
import subprocess

import numpy as np

SR = 24000
HOP = 240  # 10 ms analysis frames
TARGET_RMS = 0.12

FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"


# ───────────────────────────────────────────── copied from tities (unchanged)

def frame_rms(a: np.ndarray, hop: int = HOP) -> np.ndarray:
    n = len(a) // hop
    return np.sqrt((a[: n * hop].reshape(n, hop) ** 2).mean(axis=1) + 1e-12)


def trim_silence(a: np.ndarray) -> np.ndarray:
    """Cut leading/trailing silence with soft fades."""
    if len(a) < 2 * HOP:
        return a
    rms = frame_rms(a)
    thr = max(1e-3, 0.04 * float(np.percentile(rms, 95)))
    voiced = np.nonzero(rms > thr)[0]
    if len(voiced) == 0:
        return a[:0]
    s = max(0, (voiced[0] - 2) * HOP)
    e = min(len(a), (voiced[-1] + 6) * HOP)
    out = a[s:e].copy()
    fade(out, min(240, len(out) // 4), min(1200, len(out) // 4))
    return out


def fade(x: np.ndarray, fade_in: int, fade_out: int) -> None:
    if fade_in:
        x[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)
    if fade_out:
        x[-fade_out:] *= np.cos(np.linspace(0, np.pi, fade_out, dtype=np.float32)) * 0.5 + 0.5


def loudness_gain(a: np.ndarray, target: float = TARGET_RMS) -> float:
    """Gain that brings voiced frames to `target` RMS (same level for every take)."""
    if len(a) < 2 * HOP:
        return 1.0
    rms = frame_rms(a)
    voiced = rms[rms > 0.25 * float(np.percentile(rms, 95))]
    if len(voiced) == 0:
        return 1.0
    level = float(np.sqrt((voiced**2).mean()))
    return min(2.5, max(0.5, target / max(level, 1e-4)))


def silence_threshold(rms: np.ndarray) -> float:
    p95 = float(np.percentile(rms, 95))
    floor = float(np.percentile(rms, 10))
    return min(0.15 * p95, max(0.02 * p95, 2.5 * floor, 1e-3))


def longest_silence(rms: np.ndarray, thr: float, f0: int, f1: int) -> tuple[int, int]:
    """Longest run of quiet frames within [f0, f1) → (start, end) frames."""
    f0, f1 = max(0, f0), min(len(rms), f1)
    best = (f0, f0)
    j = f0
    while j < f1:
        if rms[j] < thr:
            k = j
            while k < f1 and rms[k] < thr:
                k += 1
            if k - j > best[1] - best[0]:
                best = (j, k)
            j = k
        else:
            j += 1
    return best


def wsola(x: np.ndarray, speed: float) -> np.ndarray:
    """Pitch-preserving time stretch (WSOLA). speed > 1 → faster."""
    if abs(speed - 1.0) < 1e-3 or len(x) == 0:
        return x
    N = int(SR * 0.030)
    Hs = N // 2
    tol = int(SR * 0.008)
    Ha = Hs * speed
    if len(x) < 2 * N:
        idx = np.arange(0, len(x), speed)
        return np.interp(idx, np.arange(len(x)), x).astype(np.float32)
    win = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N)).astype(np.float32)
    xp = np.pad(x, (tol, N + 2 * tol + Hs)).astype(np.float32)
    n_frames = int((len(x) - N) / Ha) + 1
    out = np.zeros(n_frames * Hs + N, dtype=np.float32)
    prev = 0
    for k in range(n_frames):
        target = int(round(k * Ha))
        if k == 0:
            best = 0
        else:
            nat = prev + Hs
            tmpl = xp[nat + tol : nat + tol + N : 2]
            region = xp[target : target + N + 2 * tol : 2]
            corr = np.correlate(region, tmpl, "valid")
            best = max(0, target - tol + 2 * int(np.argmax(corr)))
        out[k * Hs : k * Hs + N] += xp[best + tol : best + tol + N] * win
        prev = best
    return out[: int(len(x) / speed)]


def onset_click(rms: np.ndarray, thr: float, first_word: float | None = None) -> int:
    """OmniVoice starts nearly every take with a short loud burst (~60–100 ms,
    heard as "yh"), then a gap, then speech. Returns the frame where real
    speech starts after such a burst, or 0 when there is none.

    The burst must end within 120 ms and be followed by ≥80 ms well below
    speech level; when ASR found the first word, it must start after the gap."""
    if len(rms) < 40:
        return 0
    level = float(np.percentile(rms, 90))
    quiet = rms < max(thr, level * 0.056)  # 25 dB below speech
    loud = np.nonzero(~quiet[:12])[0]
    if len(loud) == 0:
        return 0
    i = int(loud[-1]) + 1
    if np.any(~quiet[i:min(len(rms), i + 8)]) or i + 8 > len(rms):
        return 0
    j = i
    while j < len(rms) and quiet[j]:
        j += 1
    if j >= len(rms) or j > 80:  # speech must follow within 0.8 s
        return 0
    if first_word is not None and first_word * 100 < i:
        return 0  # ASR heard a word inside the "burst": it is speech
    return j


# ───────────────────────────────────────────── COLD BOOT additions

def whisperize(x: np.ndarray, amount: float = 1.0, order: int = 26) -> np.ndarray:
    """Turn voiced speech into a whisper of the same speaker: keep the LPC
    spectral envelope (the vocal tract = who it is) per 25 ms frame, replace the
    excitation with noise. `amount` < 1 mixes the original back in (breathy).

    Used on a character's reference clip: cloning from the whispered reference
    makes OmniVoice whisper *new* text in the same timbre (OmniVoice ignores
    `instruct` when cloning, so the reference is the only style control)."""
    from scipy.linalg import solve_toeplitz
    from scipy.signal import lfilter

    x = x.astype(np.float64)
    n, hop = 600, 300
    win = np.hanning(n)
    y = np.zeros(len(x) + n)
    rng = np.random.default_rng(1234)
    for i in range(0, max(0, len(x) - n), hop):
        f = x[i : i + n] * win
        r = np.correlate(f, f, "full")[n - 1 : n + order]
        if r[0] < 1e-9:
            continue
        r = r.copy()
        r[0] *= 1.0001
        a = solve_toeplitz(r[:-1], r[1:])
        A = np.concatenate([[1.0], -a])
        res = lfilter(A, [1.0], f)
        g = np.sqrt(np.mean(res**2))
        y[i : i + n] += lfilter([1.0], A, rng.standard_normal(n) * g) * win
    y = y[: len(x)]
    y *= np.sqrt(np.mean(x**2)) / (np.sqrt(np.mean(y**2)) + 1e-12)
    out = amount * y + (1 - amount) * x
    return out.astype(np.float32)


def pitch_shift(x: np.ndarray, semitones: float) -> np.ndarray:
    """Resample (shifts pitch *and* formants) then WSOLA back to the original length."""
    if abs(semitones) < 1e-3:
        return x
    r = 2 ** (semitones / 12)
    idx = np.arange(0, len(x) - 1, r)
    y = np.interp(idx, np.arange(len(x)), x).astype(np.float32)  # faster + higher
    return wsola(y, 1 / r)  # back to the original duration


def derive_ref(x: np.ndarray, spec: dict) -> np.ndarray:
    """Variant reference from the base reference: {"whisper": 0..1, "pitch": semitones, "pace": >1 faster}."""
    y = x.astype(np.float32)
    if spec.get("pitch"):
        y = pitch_shift(y, float(spec["pitch"]))
    if spec.get("pace") and abs(float(spec["pace"]) - 1) > 1e-3:
        y = wsola(y, float(spec["pace"]))
    if spec.get("whisper"):
        y = whisperize(y, float(spec["whisper"]))
    y = y * loudness_gain(y)
    peak = float(np.abs(y).max()) if len(y) else 0
    if peak > 0.97:
        y *= 0.97 / peak
    return y.astype(np.float32)


def _yin_f0(x: np.ndarray, sr: int, fmin: float = 60, fmax: float = 450, thr: float = 0.3) -> float | None:
    """YIN pitch of one frame (cumulative-mean-normalised difference, first dip below `thr`)."""
    tmin, tmax = int(sr / fmax), int(sr / fmin)
    w = len(x) - tmax
    if w <= tmin:
        return None
    d = np.array([np.sum((x[:w] - x[t : t + w]) ** 2) for t in range(tmax + 1)])
    cm = np.ones_like(d)
    cs = np.cumsum(d[1:])
    cm[1:] = d[1:] * np.arange(1, len(d)) / np.maximum(cs, 1e-12)
    for t in range(tmin, tmax):
        if cm[t] < thr:
            while t + 1 < tmax and cm[t + 1] < cm[t]:
                t += 1
            return sr / t
    return None


def analyze(a: np.ndarray, sr: int = SR) -> dict:
    """Rough voice stats: median F0 (Hz, YIN on 16 kHz), voiced fraction of speech frames, spectral centroid (Hz)."""
    from scipy.signal import resample_poly

    if len(a) < sr // 4:
        return {"f0": 0.0, "voiced": 0.0, "centroid": 0.0}
    x = resample_poly(a, 2, 3).astype(np.float64) if sr == 24000 else a.astype(np.float64)
    fs = 16000 if sr == 24000 else sr
    hop, win = int(fs * 0.01), int(fs * 0.045)
    starts = list(range(0, len(x) - win, hop * 2))
    rms = np.array([np.sqrt(np.mean(x[i : i + win] ** 2)) for i in starts])
    thr = 0.15 * float(np.percentile(rms, 95))
    f0s, speech = [], 0
    for k, i in enumerate(starts):
        if rms[k] < thr:
            continue
        speech += 1
        f = _yin_f0(x[i : i + win] - x[i : i + win].mean(), fs)
        if f:
            f0s.append(f)
    spec = np.abs(np.fft.rfft(a))
    fr = np.fft.rfftfreq(len(a), 1 / sr)
    return {
        "f0": round(float(np.median(f0s)), 1) if f0s else 0.0,
        "voiced": round(len(f0s) / max(1, speech), 2),
        "centroid": round(float((spec * fr).sum() / max(1e-9, spec.sum()))),
    }


def timbre(a: np.ndarray, sr: int = SR) -> np.ndarray:
    """Crude timbre signature: mean MFCC (1..19) over loud frames."""
    from scipy.fft import dct

    n, hop = 1024, 240
    if len(a) < n * 2:
        return np.zeros(19)
    fr = np.array([a[i : i + n] * np.hanning(n) for i in range(0, len(a) - n, hop)])
    S = np.abs(np.fft.rfft(fr, axis=1)) ** 2
    e = S.sum(1)
    S = S[e > 0.05 * np.percentile(e, 95)]
    freqs = np.fft.rfftfreq(n, 1 / sr)
    mel = 2595 * np.log10(1 + freqs / 700)
    edges = np.linspace(mel[1], 2595 * np.log10(1 + 8000 / 700), 42)
    fb = np.array([((mel >= edges[i]) & (mel < edges[i + 2])).astype(float) for i in range(40)])
    L = np.log(S @ fb.T + 1e-9)
    return dct(L, axis=1, norm="ortho")[:, 1:20].mean(0)


def similarity(a: np.ndarray, b: np.ndarray) -> float:
    ta, tb = timbre(a), timbre(b)
    return float(ta @ tb / (np.linalg.norm(ta) * np.linalg.norm(tb) + 1e-12))


def read_wav(path) -> np.ndarray:
    from mlx_audio.audio_io import read

    w, sr = read(str(path))
    w = np.asarray(w, dtype=np.float32)
    if w.ndim > 1:
        w = w.mean(axis=1)
    if sr != SR:
        w = np.interp(np.arange(0, len(w), sr / SR), np.arange(len(w)), w).astype(np.float32)
    return w


def write_wav(path, a: np.ndarray) -> None:
    from mlx_audio.audio_io import write

    write(str(path), a.astype(np.float32), SR)


def encode_mp3(a: np.ndarray, path, kbps: int = 64) -> None:
    """Mono mp3 (MPEG-2 layer 3 at 24 kHz) via ffmpeg."""
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1",
         "-i", "pipe:0", "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-ar", str(SR), "-ac", "1",
         "-map_metadata", "-1", "-id3v2_version", "0", str(path)],
        input=a.astype(np.float32).tobytes(), check=True,
    )


def decode_mp3(path) -> np.ndarray:
    p = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ac", "1",
         "-ar", str(SR), "pipe:1"],
        capture_output=True, check=True,
    )
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def mp3_roundtrip(a: np.ndarray) -> np.ndarray:
    """What the game will decode: encode like `encode_mp3`, decode again (for the ASR check)."""
    import os
    import tempfile

    fd, path = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    try:
        encode_mp3(a, path)
        return decode_mp3(path)
    finally:
        os.unlink(path)
