// Assemble the demo from the captured clips (scripts/demo/capture.mjs → shots/demo/clips/*).
//   node scripts/demo/edit.mjs            → shots/demo/cold-boot-demo.mp4 + shots/demo/contact.png
//   node scripts/demo/edit.mjs --contact  → only the 1 fps contact sheet of the cut (no final encode)
// Segment times may be numbers (seconds into the clip) or "mark±offset" using the marks a shot recorded.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CLIPS = 'shots/demo/clips';
const OUT = 'shots/demo/cold-boot-demo.mp4';
const FPS = 60;

// [clip, in, out, transition INTO this segment: 'black' | 'fade' | 'glitch' | 'cut']
const EDL = [
  ['A', 'cards+0.2', 'cards+5.0', 'cut'],          // COLD BOOT title card
  ['A', 'wake+4.4', 'wake+10.2', 'black'],          // eyes open in Medical 3-A
  ['A', 'flashlight-0.3', 'flashlight+2.6', 'cut'], // flashlight on, look around
  ['A', 'monitor-0.2', 'monitor+2.6', 'cut'],      // the flat monitor gives two heartbeats
  ['A', 'arm-0.3', 'arm+2.6', 'cut'],              // the arm slides off the gurney
  ['A', 'note-0.3', 'note+3.2', 'fade'],           // reading the terminal
  ['A', 'lights-0.4', 'lights+5.4', 'glitch'],     // corridor: lights chase, figure crosses (CHOIR PA)
  ['B', 'vent-0.5', 'vent+2.6', 'black'],          // security: the vent grille drops
  ['B', 'husk-0.2', 'fight-0.2', 'cut'],           // the slumped android stands up
  ['B', 'fight-0.2', 'dead+1.0', 'cut'],           // pistol: shots, hits, reload
  ['C', 'airlock+0.2', 'airlock+4.2', 'glitch'],   // decon lock cycles (CHECKPOINT RESTORED toast)
  ['C', 'hall+5.8', 'hall+11.6', 'fade'],           // Fabrication Hall 3: light shafts, hanging units
  ['D', 'shotgun-1.0', 'key+0.8', 'black'],        // pump room: take the shotgun + the key
  ['D', 'skitters+0.0', 'reload+2.2', 'cut'],      // skitters from the sump: pump, reload
  ['E', 'return+0.0', 'cleared+0.6', 'glitch'],    // back in the hall
  ['E', 'checkpoint-1.2', 'checkpoint+2.0', 'black'], // at the breaker: CHECKPOINT
  ['E', 'lever-0.2', 'lever+4.8', 'cut'],          // power restored
  ['E', 'wave+0.5', 'wave+7.5', 'glitch'],         // the rack drops: the wave
  ['Z', 'card+0.0', 'end-1.0', 'black'],           // end card + URL
];
const TD = { black: 0.6, fade: 0.35, glitch: 0.12, cut: 1 / FPS };

const meta = {};
const resolve = (clip, v) => {
  if (typeof v === 'number') return v;
  meta[clip] ??= JSON.parse(readFileSync(`${CLIPS}/${clip}.json`, 'utf8'));
  const m = /^([\w-]+?)([+-][\d.]+)?$/.exec(v);
  const mk = meta[clip].marks.find(([n]) => n === m[1]);
  if (!mk) throw new Error(`clip ${clip}: no mark "${m[1]}"`);
  return Math.max(0, Math.min(meta[clip].seconds - 1 / FPS, mk[1] + Number(m[2] ?? 0)));
};

const segs = EDL.map(([clip, a, b, tr]) => {
  const s = resolve(clip, a), e = resolve(clip, b);
  return { clip, s: Math.round(s * FPS) / FPS, e: Math.round(e * FPS) / FPS, tr };
});
const inputs = [...new Set(segs.map((x) => x.clip))];
const args = ['-y', '-hide_banner', '-loglevel', 'error'];
for (const c of inputs) args.push('-i', `${CLIPS}/${c}.mp4`, '-i', `${CLIPS}/${c}.wav`);
const vi = (c) => inputs.indexOf(c) * 2, ai = (c) => inputs.indexOf(c) * 2 + 1;

const f = [];
segs.forEach((g, i) => {
  f.push(`[${vi(g.clip)}:v]trim=start=${g.s}:end=${g.e},setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p[v${i}]`);
  f.push(`[${ai(g.clip)}:a]atrim=start=${g.s}:end=${g.e},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`);
});
// chain with xfade / acrossfade
let vPrev = 'v0', aPrev = 'a0', total = segs[0].e - segs[0].s;
const cutTimes = [];
for (let i = 1; i < segs.length; i++) {
  const g = segs[i], td = TD[g.tr];
  const type = g.tr === 'black' ? 'fadeblack' : 'fade';
  const off = total - td;
  f.push(`[${vPrev}][v${i}]xfade=transition=${type}:duration=${td.toFixed(4)}:offset=${off.toFixed(4)}[vx${i}]`);
  f.push(`[${aPrev}][a${i}]acrossfade=d=${Math.max(0.04, g.tr === 'black' ? td : td).toFixed(3)}:c1=tri:c2=tri[ax${i}]`);
  if (g.tr === 'glitch') cutTimes.push(off + td / 2);
  vPrev = `vx${i}`; aPrev = `ax${i}`;
  total = off + (g.e - g.s);
}
// glitch transitions: a few frames of RGB split + noise + horizontal smear around the cut (the game's own
// damage/CHOIR glitch look), never on the cards
let gl = `[${vPrev}]`;
if (cutTimes.length) {
  const en = cutTimes.map((t) => `between(t,${(t - 0.13).toFixed(3)},${(t + 0.15).toFixed(3)})`).join('+');
  f.push(`${gl}rgbashift=rh=-14:bh=14:gv=4:enable='${en}',noise=alls=34:allf=t:enable='${en}',gblur=sigma=6:sigmaV=0.01:enable='${en}'[vg]`);
  gl = '[vg]';
}
f.push(`${gl}fade=t=in:st=0:d=0.5,fade=t=out:st=${(total - 0.8).toFixed(3)}:d=0.8,format=yuv420p[vout]`);
f.push(`[${aPrev}]afade=t=in:st=0:d=0.4,afade=t=out:st=${(total - 1.0).toFixed(3)}:d=1.0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);

const contactOnly = process.argv.includes('--contact');
if (!contactOnly) {
  execFileSync('ffmpeg', [...args, '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-maxrate', '14M', '-bufsize', '28M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-g', '120', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
}
const src = contactOnly ? null : OUT;
if (src) {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-vf', 'fps=1,scale=400:-1,tile=8x12:padding=4', '-frames:v', '1', 'shots/demo/contact.png'], { stdio: 'inherit' });
}
let t = 0;
console.log('segments:');
segs.forEach((g, i) => {
  const start = i === 0 ? 0 : t - TD[g.tr];
  t = start + (g.e - g.s);
  console.log(`  ${start.toFixed(2).padStart(6)}–${t.toFixed(2).padStart(6)}  ${g.clip} ${g.s.toFixed(2)}–${g.e.toFixed(2)}  (${g.tr})  ${EDL[i][0]} ${EDL[i][1]}`);
});
console.log(`total ${total.toFixed(2)} s → ${contactOnly ? '(no encode)' : OUT}`);
