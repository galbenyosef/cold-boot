"""voice/report.html — one player per line, grouped by character."""

from __future__ import annotations

import html
import time

from . import project as P


def _e(s) -> str:
    return html.escape(str(s if s is not None else ""))


def write_report():
    cast = P.load_cast()
    lines, problems = P.load_lines(cast)
    man = P.load_manifest()["lines"]
    chk = P.load_json(P.CHECK, {}).get("lines", {})
    total = sum(f.stat().st_size for f in P.PUBLIC.glob("*.mp3")) if P.PUBLIC.exists() else 0
    by_char: dict[str, list[P.Line]] = {}
    for ln in lines:
        by_char.setdefault(ln.speaker, []).append(ln)

    fails, missing = [], []
    secs = []
    for char, entry in cast["characters"].items():
        ls = by_char.get(char, [])
        meta = P.load_json(P.ref_paths(char)[2], {})
        var_refs = "".join(
            f"<span class=vref>{_e(v)}: <audio controls preload=none src='refs/{char}.{v}.wav'></audio></span>"
            for v in (entry.get("variants") or {}) if P.ref_paths(char, v)[0].exists())
        rows = []
        dur = 0.0
        for ln in ls:
            m = man.get(ln.id)
            c = chk.get(ln.id) or {}
            if not m:
                missing.append(ln.id)
                rows.append(f"<tr class=miss id='{ln.id}'><td><b>{_e(ln.id)}</b><br><small>{ln.level}</small></td>"
                            f"<td colspan=2>not generated</td><td>{_e(ln.text)}</td><td></td></tr>")
                continue
            ok = c.get("ok", m.get("ok")) and not c.get("stale")
            score = c.get("score", m.get("score"))
            heard = c.get("transcript", m.get("transcript", ""))
            if not ok:
                fails.append(ln.id)
            dur += m.get("duration", 0)
            spoken = f"<div class=sp>spoken: {_e(ln.spoken)}</div>" if ln.spoken != ln.text else ""
            note = f"<div class=note>{_e(ln.note)}</div>" if ln.note else ""
            rows.append(
                f"<tr class='{'ok' if ok else 'bad'}' id='{ln.id}'>"
                f"<td><b>{_e(ln.id)}</b><br><small>{ln.level} · fx {_e(m.get('fx'))}"
                f"{' · ' + _e(ln.variant) if ln.variant else ''}</small></td>"
                f"<td><audio controls preload=none src='../public/voice/{ln.id}.mp3'></audio>"
                f"<br><small>{m.get('duration', 0):.2f}s · {m.get('tries', 1)} take(s)</small></td>"
                f"<td class=sc>{score:.2f}<br><small>{'ok' if ok else 'CHECK'}</small></td>"
                f"<td>{_e(ln.text)}{spoken}{note}<div class=heard>heard: {_e(heard)}</div></td>"
                f"<td><textarea data-id='{ln.id}' placeholder='feedback…'></textarea></td></tr>")
        if not ls and not P.ref_paths(char)[0].exists():
            continue
        secs.append(
            f"<section id='c-{char}'><h2>{_e(entry.get('name', char))} <small>({char}) — {len(ls)} lines, "
            f"{dur:.0f}s</small></h2>"
            f"<p class=desc>“{_e(entry.get('describe'))}” · seed {_e(entry.get('seed'))} · default fx "
            f"<b>{_e(entry.get('fx', 'clean'))}</b>{' · ' + _e(entry.get('why')) if entry.get('why') else ''}</p>"
            f"<p>reference: <audio controls preload=none src='refs/{char}.wav'></audio> "
            f"<small>{_e(meta.get('source', ''))} — “{_e(entry.get('refText'))}”</small> {var_refs}</p>"
            f"<table>{''.join(rows)}</table>"
            f"<textarea class=cf data-id='{char}' placeholder='feedback on the {char} voice overall…'></textarea></section>")

    nav = " · ".join(f"<a href='#c-{c}'>{c}</a>" for c in cast["characters"] if c in by_char)
    summary = (f"{len(lines)} lines · {len(lines) - len(missing)} generated · {len(fails)} failing the ASR check"
               f"{' (' + ', '.join(f'<a href=#{x}>{x}</a>' for x in fails) + ')' if fails else ''}"
               f" · {len(missing)} missing · public/voice {total / 1e6:.1f} MB")
    probs = "".join(f"<li>{_e(p)}</li>" for p in problems)
    doc = f"""<!doctype html><meta charset=utf-8><title>COLD BOOT voices</title>
<style>
:root{{--bg:#101214;--fg:#d8dde2;--dim:#8a939c;--ok:#5fbf7f;--bad:#e06a5a;--line:#2a2f35}}
body{{font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:1200px;margin:0 auto;padding:16px}}
a{{color:#8cc8ff}} h2 small,small{{color:var(--dim);font-weight:normal}}
table{{border-collapse:collapse;width:100%}} td{{border-top:1px solid var(--line);padding:6px;vertical-align:top}}
audio{{height:30px;width:220px}} .sc{{font-weight:bold;text-align:center}} tr.ok .sc{{color:var(--ok)}} tr.bad .sc{{color:var(--bad)}}
tr.bad{{background:#2a1a18}} tr.miss{{opacity:.6}} .heard{{color:var(--dim);font-size:12px;margin-top:2px}}
.note{{color:#e0c070;font-style:italic;font-size:12px}} .sp{{color:#9fb7ff;font-size:12px}} .desc{{color:var(--dim)}}
textarea{{width:180px;height:44px;background:#181b1f;color:var(--fg);border:1px solid var(--line)}} textarea.cf{{width:100%;height:50px}}
.vref{{margin-left:12px}} section{{margin-top:28px}} button{{font:inherit}}
</style>
<h1>COLD BOOT — voice lines</h1>
<p>{summary}<br><small>generated {time.strftime('%Y-%m-%d %H:%M')}. Clean takes (no game fx) — the in-game processing
(CHOIR layering, intercom, unit, recorder) is applied at run time: audition it in <code>dev/audio.html</code>.
Feedback is kept in this browser; “copy feedback” puts it on the clipboard.</small></p>
<p><button id=copy>copy feedback</button> {nav}</p>
{'<ul>' + probs + '</ul>' if probs else ''}
{''.join(secs)}
<script>
const K='coldboot.voicefb';let fb={{}};try{{fb=JSON.parse(localStorage.getItem(K)||'{{}}')}}catch(e){{}}
document.querySelectorAll('textarea').forEach(t=>{{t.value=fb[t.dataset.id]||'';t.oninput=()=>{{fb[t.dataset.id]=t.value;try{{localStorage.setItem(K,JSON.stringify(fb))}}catch(e){{}}}}}});
document.getElementById('copy').onclick=()=>{{const s=Object.entries(fb).filter(([k,v])=>v.trim()).map(([k,v])=>k+': '+v.trim()).join('\\n');navigator.clipboard.writeText(s);}};
document.addEventListener('play',e=>{{document.querySelectorAll('audio').forEach(a=>{{if(a!==e.target)a.pause()}})}},true);
</script>"""
    P.REPORT.write_text(doc)
    return P.REPORT
