"""Repo layout, cast, references, lines, manifest, hashing."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import audio as A
from .engine import GLOBAL_KNOBS, KNOB_DEFAULTS

GEN_VERSION = 1  # bump to regenerate everything after a pipeline change

ROOT = Path(os.environ.get("COLDVOICE_ROOT", Path(__file__).resolve().parents[3]))
VOICE = ROOT / "voice"
CAST = VOICE / "cast.json"
REFS = VOICE / "refs"
AUDITIONS = VOICE / "auditions"
MANIFEST = VOICE / "manifest.json"
CHECK = VOICE / "check.json"
REPORT = VOICE / "report.html"
PUBLIC = ROOT / "public" / "voice"
ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def load_json(p: Path, default):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default


def save_json(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(p)


class Lock:
    """One generation process at a time (MLX: one ML thread; also keeps the manifest sane)."""

    def __enter__(self):
        VOICE.mkdir(parents=True, exist_ok=True)
        AUDITIONS.mkdir(parents=True, exist_ok=True)
        self.f = open(AUDITIONS / ".lock", "w")  # gitignored dir
        try:
            fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("another voice process is running (voice/auditions/.lock) — wait for it to finish")
        return self

    def __exit__(self, *a):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


# ───────────────────────────────────────────── cast

def load_cast() -> dict:
    c = load_json(CAST, None)
    if not c or "characters" not in c:
        raise SystemExit(f"{rel(CAST)} missing or invalid")
    return c


def char_entry(cast: dict, char: str) -> dict:
    e = cast["characters"].get(char)
    if e is None:
        raise KeyError(char)
    return e


def knobs_for(entry: dict, variant: dict | None = None) -> dict:
    k = dict(KNOB_DEFAULTS)
    k.update(entry.get("knobs") or {})
    if variant:
        k.update(variant.get("knobs") or {})
    return k


def target_rms(entry: dict, variant: dict | None) -> float:
    db = float(entry.get("level", 0)) + float((variant or {}).get("level", 0))
    return A.TARGET_RMS * 10 ** (db / 20)


@dataclass
class Ref:
    char: str
    variant: str | None
    wav: Path
    text: str
    sha: str

    @property
    def key(self) -> str:
        return f"{self.char}:{self.variant or ''}:{self.sha}"

    def audio(self) -> np.ndarray:
        return A.read_wav(self.wav)


def ref_paths(char: str, variant: str | None = None) -> tuple[Path, Path, Path]:
    stem = char if not variant else f"{char}.{variant}"
    w = REFS / f"{stem}.wav"
    return w, w.with_suffix(".txt"), w.with_suffix(".json")


def design_fields(entry: dict, cast: dict) -> dict:
    return {"describe": entry.get("describe", ""), "seed": int(entry.get("seed", 0)),
            "refText": entry["refText"], "language": entry.get("language", cast.get("language", "en"))}


def install_ref(char: str, audio: np.ndarray, fields: dict, source: str, check: dict | None) -> Ref:
    REFS.mkdir(parents=True, exist_ok=True)
    w, t, j = ref_paths(char)
    A.write_wav(w, audio)
    t.write_text(fields["refText"] + "\n")
    meta = dict(fields, source=source, sha=sha(w), duration=round(len(audio) / A.SR, 2))
    if check:
        meta["asr"] = {k: check[k] for k in ("ok", "score", "transcript")}
    save_json(j, meta)
    # DSP-derived variant refs depend on the base clip → stale now (designed variant refs do not)
    for vj in REFS.glob(f"{char}.*.json"):
        if "derive" in load_json(vj, {}):
            for p in REFS.glob(vj.stem + ".*"):
                p.unlink()
    return Ref(char, None, w, fields["refText"], meta["sha"])


def variant_fields(entry: dict, v: dict, cast: dict) -> dict:
    """Design fields of a *designed* variant reference (variant has its own describe/seed/refText)."""
    return {"describe": v.get("describe", ""), "seed": int(v.get("seed", 0)),
            "refText": v.get("refText") or entry["refText"],
            "language": entry.get("language", cast.get("language", "en"))}


def install_variant_ref(char: str, variant: str, audio: np.ndarray, fields: dict, source: str,
                        check: dict | None) -> Ref:
    REFS.mkdir(parents=True, exist_ok=True)
    w, t, j = ref_paths(char, variant)
    A.write_wav(w, audio)
    t.write_text(fields["refText"] + "\n")
    meta = dict(fields, source=source, sha=sha(w), duration=round(len(audio) / A.SR, 2))
    if check:
        meta["asr"] = {k: check[k] for k in ("ok", "score", "transcript")}
    save_json(j, meta)
    return Ref(char, variant, w, fields["refText"], meta["sha"])


def ensure_ref(eng, cast: dict, char: str, log=print) -> Ref:
    """The character's base reference. Re-designed from cast.json (description + seed) whenever
    the entry no longer matches the committed clip — that is how a cast edit swaps a voice."""
    entry = char_entry(cast, char)
    fields = design_fields(entry, cast)
    w, t, j = ref_paths(char)
    meta = load_json(j, {})
    current = w.exists() and t.exists() and all(meta.get(k) == v for k, v in fields.items())
    if entry.get("refLocked") and w.exists() and t.exists():
        current = True  # a hand-made / externally recorded reference: never redesign
    if not current:
        log(f"[{char}] designing reference: '{fields['describe']}' seed {fields['seed']}")
        a = eng.design(fields["describe"], fields["seed"], fields["refText"], fields["language"])
        chk = eng.score(a, fields["refText"])
        if not chk["ok"]:
            log(f"[{char}] WARNING reference take does not match its text (ASR: {chk['transcript']!r}); "
                f"try another seed with `npm run voice:cast -- {char}`")
        return install_ref(char, a, fields, "design", chk)
    return Ref(char, None, w, t.read_text().strip(), sha(w))


def ensure_variant_ref(eng, cast: dict, char: str, variant: str, log=print) -> Ref:
    """A variant's reference. Three kinds (cast.json `variants.<name>`):
      describe/seed/refText  a DESIGNED reference of its own (e.g. "…, whispering": the model really
                             whispers) — re-designed whenever those fields change, like a base voice;
      derive                 legacy: DSP transform of the base clip (audio.derive_ref) — sounded robotic;
      neither                the base reference (the variant only changes knobs / level / fx)."""
    entry = char_entry(cast, char)
    v = (entry.get("variants") or {}).get(variant)
    if v is None:
        raise KeyError(f"{char}:{variant}")
    w, t, j = ref_paths(char, variant)
    meta = load_json(j, {})
    if v.get("describe"):
        fields = variant_fields(entry, v, cast)
        current = w.exists() and t.exists() and all(meta.get(k) == x for k, x in fields.items())
        if v.get("refLocked") and w.exists() and t.exists():
            current = True
        if not current:
            log(f"[{char}:{variant}] designing reference: '{fields['describe']}' seed {fields['seed']}")
            a = eng.design(fields["describe"], fields["seed"], fields["refText"], fields["language"])
            chk = eng.score(a, fields["refText"])
            if not chk["ok"]:
                log(f"[{char}:{variant}] WARNING reference take does not match its text (ASR: "
                    f"{chk['transcript']!r}); audition with `npm run voice:cast -- {char}:{variant}`")
            return install_variant_ref(char, variant, a, fields, "design", chk)
        return Ref(char, variant, w, t.read_text().strip(), sha(w))
    base = ensure_ref(eng, cast, char, log)
    derive = v.get("derive") or {}
    if not derive:
        for p in (w, t, j):  # a stale clip from an earlier kind of this variant
            p.unlink(missing_ok=True)
        return base
    if "derive" not in meta:
        meta = {}
    if not (w.exists() and meta.get("base") == base.sha and meta.get("derive") == derive):
        log(f"[{char}:{variant}] deriving reference {derive}")
        a = A.derive_ref(base.audio(), derive)
        A.write_wav(w, a)
        t.write_text(base.text + "\n")
        save_json(j, {"base": base.sha, "derive": derive, "sha": sha(w)})
    return Ref(char, variant, w, base.text, sha(w))


# ───────────────────────────────────────────── lines

@dataclass
class Line:
    id: str
    speaker: str  # cast character
    variant: str | None
    text: str  # subtitle
    spoken: str  # what is said
    note: str
    fx: str | None
    level: str  # "l1" | "l2" | other file tag
    raw_speaker: str


def lines_files() -> list[Path]:
    return sorted(VOICE.glob("lines.*.json"))


def resolve_variant(entry: dict, explicit: str | None, note: str) -> str | None:
    variants = entry.get("variants") or {}
    if explicit:
        return explicit if explicit in variants else None
    n = note.lower()
    for name, v in variants.items():
        if any(m.lower() in n for m in v.get("match", [])):
            return name
    return None


def load_lines(cast: dict, files: list[Path] | None = None) -> tuple[list[Line], list[str]]:
    lines: list[Line] = []
    problems: list[str] = []
    seen: set[str] = set()
    alias = {k.lower(): v for k, v in (cast.get("aliases") or {}).items()}
    for f in files if files is not None else lines_files():
        data = load_json(f, None)
        if isinstance(data, dict):
            data = data.get("lines", [])
        if not isinstance(data, list):
            problems.append(f"{rel(f)}: not a JSON array of lines")
            continue
        tag = f.stem.split(".", 1)[-1]
        for d in data:
            lid = str(d.get("id", ""))
            if not ID_RE.match(lid):
                problems.append(f"{rel(f)}: bad id {lid!r}")
                continue
            if lid in seen:
                problems.append(f"{rel(f)}: duplicate id {lid}")
                continue
            seen.add(lid)
            spk = str(d.get("speaker", "")).strip()
            base, _, var = spk.lower().partition(":")
            base = alias.get(base, base)
            if base not in cast["characters"]:
                problems.append(f"{lid}: speaker {spk!r} has no cast entry")
                continue
            entry = cast["characters"][base]
            note = str(d.get("note") or "")
            variant = resolve_variant(entry, var or None, note)
            if var and variant is None:
                problems.append(f"{lid}: variant {var!r} not defined for {base} — using the base voice")
            text = str(d.get("text") or "").strip()
            spoken = str(d.get("spoken") or text).strip()
            if not spoken:
                problems.append(f"{lid}: empty text")
                continue
            lines.append(Line(lid, base, variant, text, spoken, note, d.get("fx"), tag, spk))
    return lines, problems


def line_hash(cast: dict, line: Line, refs: list[Ref]) -> str:
    entry = char_entry(cast, line.speaker)
    v = (entry.get("variants") or {}).get(line.variant) if line.variant else None
    payload = {
        "gen": GEN_VERSION, "global": GLOBAL_KNOBS, "speaker": line.speaker, "variant": line.variant,
        "spoken": line.spoken, "ref": [r.sha for r in refs], "refText": [r.text for r in refs], "seed": int(entry.get("seed", 0)),
        "lineSeed": entry.get("lineSeed", 0), "knobs": knobs_for(entry, v), "rms": target_rms(entry, v),
        "layers": [(knobs_for(char_entry(cast, c)), char_entry(cast, c).get("level", 0)) for c in entry.get("layers") or []],
        "language": entry.get("language", cast.get("language", "en")),
    }
    if (entry.get("lineSeeds") or {}).get(line.id):  # per-line re-roll (only in the hash when set)
        payload["lineSeeds"] = entry["lineSeeds"][line.id]
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def line_fx(cast: dict, line: Line) -> str:
    entry = char_entry(cast, line.speaker)
    v = (entry.get("variants") or {}).get(line.variant) if line.variant else None
    if line.fx:
        return line.fx
    for r in entry.get("fxRules") or []:
        if ("id" in r and re.search(r["id"], line.id)) or ("note" in r and r["note"].lower() in line.note.lower()):
            return r["fx"]
    return (v or {}).get("fx") or entry.get("fx") or "clean"


def load_manifest() -> dict:
    m = load_json(MANIFEST, {})
    m.setdefault("lines", {})
    return m


def save_manifest(m: dict) -> None:
    m["lines"] = dict(sorted(m["lines"].items()))
    m["version"] = GEN_VERSION
    save_json(MANIFEST, m)


def layers_of(cast: dict, ln: Line) -> list[tuple[str, str | None]]:
    """[(char, variant)] — one per audio file. A cast entry with "layers" (the foreman) is spoken by
    several characters at once; the runtime plays them out of sync."""
    entry = char_entry(cast, ln.speaker)
    if entry.get("layers"):
        out = []
        for c in entry["layers"]:
            ce = char_entry(cast, c)
            out.append((c, ln.variant if ln.variant in (ce.get("variants") or {}) else None))
        return out
    return [(ln.speaker, ln.variant)]


def line_files(cast: dict, ln: Line) -> list[str]:
    n = len(layers_of(cast, ln))
    return [f"{ln.id}.mp3"] + [f"{ln.id}.L{k}.mp3" for k in range(1, n)]


def existing_ref(char: str, variant: str | None, cast: dict | None = None) -> Ref | None:
    w, t, _ = ref_paths(char, variant)
    if variant and cast is not None:
        v = (char_entry(cast, char).get("variants") or {}).get(variant) or {}
        if not v.get("describe") and not v.get("derive"):
            return existing_ref(char, None)  # a variant that uses the base reference
    if not (w.exists() and t.exists()):
        return None
    return Ref(char, variant, w, t.read_text().strip(), sha(w))
