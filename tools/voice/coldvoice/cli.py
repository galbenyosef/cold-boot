"""coldvoice — COLD BOOT voice line generator.

    coldvoice gen   [--only ID|PREFIX[,…]] [--speaker CHAR[,…]] [--force] [--dry]
    coldvoice cast  CHAR [--describe "…"]… [--seed N] [--audition K] [--text "…"]
    coldvoice cast  CHAR --pick N
    coldvoice cast  CHAR:VARIANT [--describe "…"]… [--audition K] | --pick N
    coldvoice check [--only …] [--speaker …]
    coldvoice report

See tools/voice/README.md.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import audio as A
from . import project as P
from .engine import Engine


def _log(msg: str) -> None:
    print(msg, flush=True)


def _match(line: P.Line, only: list[str], speakers: list[str]) -> bool:
    if only and not any(line.id == o or line.id.startswith(o) for o in only):
        return False
    if speakers and line.speaker not in speakers and f"{line.speaker}:{line.variant}" not in speakers:
        return False
    return True


# ───────────────────────────────────────────── gen

def cmd_gen(a) -> int:
    only = [x.strip() for v in a.only or [] for x in v.split(",") if x.strip()]
    speakers = [x.strip().lower() for v in a.speaker or [] for x in v.split(",") if x.strip()]
    with P.Lock():
        cast = P.load_cast()
        lines, problems = P.load_lines(cast)
        for p in problems:
            _log(f"! {p}")
        if not P.lines_files():
            _log("no voice/lines.*.json files yet — nothing to generate")
        man = P.load_manifest()
        eng = Engine(_log)
        P.PUBLIC.mkdir(parents=True, exist_ok=True)
        todo = [ln for ln in lines if _match(ln, only, speakers)]
        refs: dict[tuple[str, str | None], P.Ref] = {}

        def ref_for(char: str, variant: str | None) -> P.Ref:
            k = (char, variant)
            if k not in refs:
                refs[k] = (P.ensure_variant_ref(eng, cast, char, variant, _log) if variant
                           else P.ensure_ref(eng, cast, char, _log))
            return refs[k]

        gen, skipped, failed = 0, 0, []
        keep_files: set[str] = set()
        t0 = time.time()
        for i, ln in enumerate(todo):
            entry = P.char_entry(cast, ln.speaker)
            layers = P.layers_of(cast, ln)
            lrefs = [ref_for(c, v) for c, v in layers]
            h = P.line_hash(cast, ln, lrefs)
            files = P.line_files(cast, ln)
            keep_files.update(files)
            old = man["lines"].get(ln.id, {})
            meta = {"speaker": ln.speaker, "variant": ln.variant, "name": entry.get("name", ln.speaker.upper()),
                    "text": ln.text, "fx": P.line_fx(cast, ln), "level": ln.level}
            if not a.force and old.get("hash") == h and all((P.PUBLIC / f).exists() for f in files):
                old.update(meta)
                skipped += 1
                continue
            if a.dry:
                _log(f"would generate {ln.id}")
                continue
            takes = []
            for k, ((c, v_name), ref) in enumerate(zip(layers, lrefs)):
                ce = P.char_entry(cast, c)
                v = (ce.get("variants") or {}).get(v_name) if v_name else None
                seed = (int(entry.get("seed", 0)) + int(entry.get("lineSeed", 0)) + 17 * k
                        + 7919 * int((entry.get("lineSeeds") or {}).get(ln.id, 0)))
                knobs = P.knobs_for(ce, v)
                lvl = 0.0
                if ce is not entry:  # a layer of a multi-voice character: its own voice, the group's knobs
                    knobs.update(entry.get("knobs") or {})
                    lvl = float(entry.get("level", 0))
                take = eng.render(ln.spoken, ref.key, ref.audio(), ref.text, seed=seed, key=ln.id, knobs=knobs,
                                  language=ce.get("language", cast.get("language", "en")),
                                  target_rms=P.target_rms(ce, v) * 10 ** (lvl / 20))
                A.encode_mp3(take.audio, P.PUBLIC / files[k])
                takes.append(take)
            t = min(takes, key=lambda x: x.score)  # a line is as good as its worst layer
            rec = dict(meta, file=f"voice/{files[0]}", duration=round(max(len(x.audio) for x in takes) / A.SR, 3),
                       hash=h, score=t.score, ok=all(x.ok for x in takes), transcript=takes[0].transcript,
                       tries=sum(x.tries for x in takes), seed=takes[0].seed, info=t.info)
            if len(takes) > 1:
                rec["layers"] = [{"file": f"voice/{f}", "speaker": c, "duration": round(len(x.audio) / A.SR, 3),
                                  "score": x.score, "ok": x.ok, "transcript": x.transcript}
                                 for f, (c, _), x in zip(files, layers, takes)]
            man["lines"][ln.id] = rec
            P.save_manifest(man)
            gen += 1
            flag = "ok " if rec["ok"] else "FAIL"
            _log(f"[{i + 1}/{len(todo)}] {flag} {ln.id} ({ln.speaker}{':' + ln.variant if ln.variant else ''}) "
                 f"{t.info} tries={rec['tries']}")
            if not rec["ok"]:
                failed.append(ln.id)
                _log(f"        text: {ln.spoken}\n        heard: {' | '.join(x.transcript for x in takes)}")
        # every line's lead-in (what the game skips before the first word), from the file that ships
        for lid, rec in man["lines"].items():
            fs = [x["file"] for x in rec.get("layers") or []] or [rec.get("file")]
            try:
                leads = [A.lead_in(A.decode_mp3(P.ROOT / "public" / f)) for f in fs if f]
            except Exception as e:  # noqa: BLE001 — a missing / broken file: no lead
                _log(f"! lead of {lid}: {e}")
                leads = [0.0]
            rec["lead"] = min(leads) if leads else 0.0
        # prune lines that no longer exist (only on a full run)
        if not only and not speakers:
            ids = {ln.id for ln in lines}
            for lid in list(man["lines"]):
                if lid not in ids:
                    del man["lines"][lid]
                    _log(f"removed stale {lid}")
            for f in P.PUBLIC.glob("*.mp3"):
                if f.name not in keep_files:
                    f.unlink()
        P.save_manifest(man)
        fails_all = [k for k, v in man["lines"].items() if not v.get("ok")]
        _log(f"generated {gen}, unchanged {skipped}, {time.time() - t0:.0f}s; "
             f"failing ASR now: {len(fails_all)}{' → ' + ', '.join(fails_all) if fails_all else ''}")
        return 0


# ───────────────────────────────────────────── cast / audition

DEFAULT_SAMPLES = [
    "Hello? Is anyone there? I can hear you breathing.",
    "Thank you. We could not have done this without you.",
]


def _samples(cast: dict, char: str, entry: dict, extra: list[str] | None, variant: str | None = None) -> list[str]:
    if extra:
        return extra
    lines, _ = P.load_lines(cast)
    own = [ln.spoken for ln in lines if ln.speaker == char and ln.variant == variant]
    own.sort(key=lambda s: -len(s))
    s = ([] if variant else (entry.get("sample") or [])) + own[:3 if variant else 2]
    return (s or DEFAULT_SAMPLES)[:3]


def _metrics_brief(m: dict) -> str:
    return (f"voiced {m['voiced']:.2f} · HNR {m['hnr']:.1f} dB · centroid {m['centroid']} Hz · "
            f"F0 sd {m['f0sd']:.2f} st · level sd {m['esd']:.2f} dB · tonal {m['tonal']:.2f}")


def cmd_cast(a) -> int:
    char, _, variant = a.char.lower().partition(":")
    variant = variant or None
    with P.Lock():
        cast = P.load_cast()
        entry = cast["characters"].setdefault(char, {})
        adir = P.AUDITIONS / (f"{char}.{variant}" if variant else char)
        if a.pick is not None:
            return _pick(cast, char, entry, adir, a.pick, variant)
        if variant:
            ventry = (entry.get("variants") or {}).get(variant)
            if ventry is None:
                raise SystemExit(f"{char}: no variant {variant!r} in cast.json (add it under variants first)")
            src = ventry
        else:
            src = entry
        if "refText" not in src and not a.ref_text:
            raise SystemExit(f"{a.char}: no refText in cast.json (pass --ref-text)")
        ref_text = a.ref_text or src["refText"]
        describes = a.describe or [src.get("describe", "")]
        seed0 = a.seed if a.seed is not None else (int(src.get("seed", 0)) + 1 if a.describe is None else 1)
        eng = Engine(_log)
        samples = _samples(cast, char, entry, a.text, variant)
        base = P.existing_ref(char, None) if variant else None
        base_a = base.audio() if base else None
        adir.mkdir(parents=True, exist_ok=True)
        idx = P.load_json(adir / "audition.json", {"char": a.char.lower(), "takes": []})
        n0 = max([t["n"] for t in idx["takes"]], default=0)
        n = n0
        lang = entry.get("language", cast.get("language", "en"))
        knobs = P.knobs_for(entry, (entry.get("variants") or {}).get(variant) if variant else None)
        for d in describes:
            for k in range(a.audition):
                n += 1
                seed = seed0 + k
                _log(f"[{a.char}] audition {n}: '{d}' seed {seed}")
                ref = eng.design(d, seed, ref_text, lang)
                chk = eng.score(ref, ref_text)
                A.write_wav(adir / f"{n:02d}-ref.wav", ref)
                stats = A.analyze(ref)
                take = {"n": n, "describe": d, "seed": seed, "refText": ref_text, "ref": f"{n:02d}-ref.wav",
                        "refAsr": chk, "stats": stats, "metrics": A.voice_metrics(ref), "samples": []}
                if base_a is not None:
                    take["toBase"] = {"env": A.envelope_similarity(ref, base_a),
                                      "mfcc": round(A.similarity(ref, base_a), 3)}
                for j, s in enumerate(samples):
                    t = eng.render(s, f"aud:{a.char}:{n}", ref, ref_text, seed=seed, key=f"sample{j}",
                                   knobs=dict(knobs, tries=2))
                    fn = f"{n:02d}-s{j}.wav"
                    A.write_wav(adir / fn, t.audio)
                    x = {"file": fn, "text": s, "score": t.score, "ok": t.ok, "transcript": t.transcript,
                         "similarity": round(A.similarity(t.audio, ref), 3), "metrics": A.voice_metrics(t.audio)}
                    if base_a is not None:
                        x["envToBase"] = A.envelope_similarity(t.audio, base_a)
                    take["samples"].append(x)
                ss = take["samples"]
                mean = sum(x["score"] for x in ss) / max(1, len(ss))
                take["meanScore"] = round(mean, 3)
                take["samplesMean"] = {k: round(sum(x["metrics"][k] for x in ss) / max(1, len(ss)), 3)
                                       for k in ("voiced", "hnr", "centroid", "f0sd", "esd", "tonal", "buzz")}
                if base_a is not None:
                    take["samplesMean"]["envToBase"] = round(sum(x["envToBase"] for x in ss) / max(1, len(ss)), 3)
                idx["takes"].append(take)
                P.save_json(adir / "audition.json", idx)
                sm = take["samplesMean"]
                _log(f"    ref asr {'ok' if chk['ok'] else 'MISMATCH'} f0={stats['f0']}Hz  samples: score {mean:.2f} "
                     f"voiced {sm['voiced']:.2f} hnr {sm['hnr']:.1f} centroid {sm['centroid']:.0f} "
                     f"f0sd {sm['f0sd']:.2f} esd {sm['esd']:.2f}"
                     f"{' env-to-base %.2f' % sm['envToBase'] if 'envToBase' in sm else ''}")
        _write_audition_html(a.char.lower(), idx, adir)
        _log(f"listen: {P.rel(adir / 'index.html')}; install with: npm run voice:cast -- {a.char.lower()} --pick <n>")
        return 0


def _pick(cast: dict, char: str, entry: dict, adir: Path, n: int, variant: str | None = None) -> int:
    idx = P.load_json(adir / "audition.json", None)
    take = next((t for t in (idx or {}).get("takes", []) if t["n"] == n), None)
    name = f"{char}:{variant}" if variant else char
    if take is None:
        raise SystemExit(f"no audition {n} for {name} in {P.rel(adir)}")
    if variant:
        v = entry["variants"][variant]
        v.pop("derive", None)
        v["describe"], v["seed"], v["refText"] = take["describe"], take["seed"], take["refText"]
        fields = P.variant_fields(entry, v, cast)
        P.install_variant_ref(char, variant, A.read_wav(adir / take["ref"]), fields, f"audition {n}",
                              take.get("refAsr"))
        dest = P.ref_paths(char, variant)[0]
    else:
        entry["describe"], entry["seed"], entry["refText"] = take["describe"], take["seed"], take["refText"]
        fields = P.design_fields(entry, cast)
        P.install_ref(char, A.read_wav(adir / take["ref"]), fields, f"audition {n}", take.get("refAsr"))
        dest = P.REFS / (char + ".wav")
    P.save_json(P.CAST, cast)
    _log(f"{name}: installed audition {n} ('{take['describe']}' seed {take['seed']}) → {P.rel(dest)}; "
         f"cast.json updated. Run `npm run voice` to regenerate {name}'s lines.")
    return 0


def _write_audition_html(char: str, idx: dict, adir: Path) -> None:
    import html

    rows = []
    for t in sorted(idx["takes"], key=lambda t: -t.get("meanScore", 0)):
        s = "".join(
            f"<div class=s><audio controls preload=none src='{x['file']}'></audio> <b>{x['score']:.2f}</b> "
            f"sim {x['similarity']:.2f} — {html.escape(x['text'])}<br><small>heard: {html.escape(x['transcript'])}"
            f"{'<br>' + _metrics_brief(x['metrics']) if 'metrics' in x else ''}</small></div>"
            for x in t["samples"])
        st = t["stats"]
        tb = t.get("toBase")
        rows.append(f"<section><h3>#{t['n']} — “{html.escape(t['describe'])}” seed {t['seed']} "
                    f"<small>mean {t.get('meanScore', 0):.2f} · f0 {st['f0']} Hz · voiced {st['voiced']} · "
                    f"ref ASR {'ok' if t['refAsr']['ok'] else 'mismatch'}"
                    f"{' · envelope similarity to the base voice %.2f' % tb['env'] if tb else ''}</small></h3>"
                    f"<div class=s><audio controls preload=none src='{t['ref']}'></audio> reference"
                    f"{' <small>' + _metrics_brief(t['metrics']) + '</small>' if 'metrics' in t else ''}</div>{s}"
                    f"<code>npm run voice:cast -- {char} --pick {t['n']}</code></section>")
    (adir / "index.html").write_text(
        f"<!doctype html><meta charset=utf-8><title>{char} auditions</title><style>"
        "body{font:14px system-ui;max-width:900px;margin:2em auto;background:#111;color:#ddd}"
        "section{border-top:1px solid #333;padding:.6em 0}.s{margin:.3em 0}audio{height:28px;vertical-align:middle}"
        "small{color:#999}code{color:#8cf}</style>"
        f"<h1>{char} — auditions</h1>{''.join(rows)}")


# ───────────────────────────────────────────── check

def cmd_check(a) -> int:
    only = [x.strip() for v in a.only or [] for x in v.split(",") if x.strip()]
    speakers = [x.strip().lower() for v in a.speaker or [] for x in v.split(",") if x.strip()]
    with P.Lock():
        cast = P.load_cast()
        lines, problems = P.load_lines(cast)
        man = P.load_manifest()
        eng = Engine(_log)
        results, bad = {}, []
        for ln in lines:
            if not _match(ln, only, speakers):
                continue
            m = man["lines"].get(ln.id)
            files = P.line_files(cast, ln)
            if not m or not all((P.PUBLIC / f).exists() for f in files):
                results[ln.id] = {"ok": False, "problem": "not generated"}
                bad.append((ln.id, "not generated", ""))
                _log(f"FAIL {ln.id:28s} not generated")
                continue
            refs = [P.existing_ref(c, v, cast) for c, v in P.layers_of(cast, ln)]
            stale = None in refs or P.line_hash(cast, ln, refs) != m.get("hash")
            scores = [eng.score(A.decode_mp3(P.PUBLIC / f), ln.spoken) for f in files]
            sc = dict(min(scores, key=lambda x: x["score"]))
            sc["ok"] = all(x["ok"] for x in scores)
            sc["transcript"] = " | ".join(x["transcript"] for x in scores)
            sc["stale"] = stale
            results[ln.id] = sc
            # the check is the authority on quality: keep the manifest's flags in step (hash untouched)
            m.update(ok=sc["ok"], score=sc["score"], transcript=sc["transcript"])
            if not sc["ok"] or stale:
                why = "stale (text/cast changed — run npm run voice)" if stale and sc["ok"] else "ASR mismatch"
                bad.append((ln.id, why, sc["transcript"]))
            _log(f"{'ok  ' if sc['ok'] and not stale else 'FAIL'} {ln.id:28s} {sc['score']:.2f}  {sc['transcript']}")
        P.save_json(P.CHECK, {"time": time.strftime("%Y-%m-%d %H:%M"), "lines": results})
        P.save_manifest(man)
        for p in problems:
            _log(f"! {p}")
        _log(f"\nchecked {len(results)} lines: {len(results) - len(bad)} ok, {len(bad)} failing")
        for lid, why, heard in bad:
            ln = next(x for x in lines if x.id == lid)
            _log(f"  {lid}: {why}\n     text:  {ln.spoken}\n     heard: {heard}")
        return 1 if bad or problems else 0


# ───────────────────────────────────────────── report

def cmd_report(a) -> int:
    from .report import write_report

    path = write_report()
    _log(f"wrote {P.rel(path)} — open it in a browser (file://{path})")
    return 0


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="coldvoice", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gen", help="generate missing / changed lines")
    g.add_argument("--only", action="append", help="line id or id prefix (comma-separated, repeatable)")
    g.add_argument("--speaker", action="append", help="character (or char:variant), comma-separated")
    g.add_argument("--force", action="store_true", help="regenerate even if unchanged")
    g.add_argument("--dry", action="store_true", help="list what would be generated")
    c = sub.add_parser("cast", help="audition / install a character's voice")
    c.add_argument("char", help="character, or character:variant (e.g. tomas:whisper)")
    c.add_argument("--describe", action="append", help="voice design description (repeatable)")
    c.add_argument("--seed", type=int, help="first seed (default: cast seed + 1)")
    c.add_argument("--audition", type=int, default=4, help="seeds per description (default 4)")
    c.add_argument("--text", action="append", help="sample line(s) to clone (default: the character's own lines)")
    c.add_argument("--ref-text", help="reference sentence (default: cast refText)")
    c.add_argument("--pick", type=int, help="install audition N as the character's reference")
    k = sub.add_parser("check", help="re-verify every file with ASR; non-zero exit on failures")
    k.add_argument("--only", action="append")
    k.add_argument("--speaker", action="append")
    sub.add_parser("report", help="write voice/report.html")
    a = ap.parse_args(argv)
    fn = {"gen": cmd_gen, "cast": cmd_cast, "check": cmd_check, "report": cmd_report}[a.cmd]
    sys.exit(fn(a))
