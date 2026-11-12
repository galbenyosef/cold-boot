// Fast social "reel" (~40 s) cut from the captured clips (scripts/demo/capture.mjs → shots/demo/clips/*).
//   node scripts/demo/reel.mjs   → shots/demo/cold-boot-reel.mp4 (1920x1080) + cold-boot-reel-vertical.mp4 (1080x1920)
//                                  + shots/demo/contact-reel.png
// Hard cuts on impacts, 30 ms audio crossfades at every cut, game-style glitch on a few cuts, the game's own
// title card (clip Z) flashed over the opening action with a screen blend, and a short end card.
import { execFileSync } from 'node:child_process';

const C = 'shots/demo/clips';
const FPS = 60;
const XF = 0.03; // audio crossfade at each cut (s)

// [clip, in, out, glitch-into-this-cut?]  (seconds into the clip)
const CUTS = [
  ['E', 36.0, 37.4, false],  // cold open: shotgun blast, sparks, red emergency light (+ title flash)
  ['B', 5.6, 7.4, false],    // the slumped android stands up
  ['A', 37.6, 39.8, false],  // the arm slides off the gurney
  ['A', 25.1, 26.6, false],  // the dead monitor spikes
  ['A', 48.0, 49.8, true],   // corridor lights die, a figure crosses
  ['B', 0.5, 2.3, false],    // the vent grille drops
  ['B', 9.0, 10.8, false],   // pistol: shots, hits
  ['B', 11.4, 13.8, false],  // reload, the kill
  ['C', 1.0, 2.8, true],     // decon steam
  ['C', 14.8, 16.6, false],  // the hall + CHOIR's glitch
  ['D', 3.0, 4.4, false],    // the shotgun
  ['D', 10.3, 12.4, false],  // skitters: blast, pump
  ['D', 13.8, 15.6, false],  // reload
  ['E', 0.2, 1.6, false],    // blast in the hall
  ['E', 20.6, 23.2, true],   // the breaker: power on
  ['E', 37.2, 39.6, false],  // the wave
  ['E', 40.6, 42.4, false],
  ['E', 44.6, 47.6, false],
];
const END = ['Z', 3.2, 6.0];   // end card: title + URL (game card UI)
const TITLE = ['Z', 3.0, 4.2]; // overlay flash at the start
const TITLE_AT = 0.2;

const segs = [...CUTS, [...END, true]];
const dur = (s) => s[2] - s[1];
const starts = [];
{ let t = 0; for (const s of segs) { starts.push(t); t += dur(s) - XF; } }
const total = starts[starts.length - 1] + dur(segs[segs.length - 1]);

function build(vertical, out) {
  const clips = [...new Set(segs.map((s) => s[0]))];
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const c of clips) args.push('-i', `${C}/${c}.mp4`, '-i', `${C}/${c}.wav`);
  const vi = (c) => clips.indexOf(c) * 2, ai = (c) => clips.indexOf(c) * 2 + 1;
  const f = [];
  // per-format framing: 16:9 as is; 9:16 = centre crop around the crosshair, the card is fitted + padded
  const frame = (isCard) => vertical
    ? (isCard ? 'scale=1080:-2,pad=1080:1920:0:(oh-ih)/2:black' : 'crop=608:1080:(iw-608)/2:0,scale=1080:1920:flags=lanczos')
    : 'null';
  segs.forEach((s, i) => {
    const isCard = i === segs.length - 1;
    f.push(`[${vi(s[0])}:v]trim=start=${s[1]}:end=${s[2]},setpts=PTS-STARTPTS,fps=${FPS},${frame(isCard)},format=yuv420p,setsar=1[v${i}]`);
    f.push(`[${ai(s[0])}:a]atrim=start=${s[1]}:end=${s[2]},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`);
  });
  // video: hard cuts (concat); audio: short crossfades. Keep lengths equal: trim XF off each video seg end
  // except the last, so cut points line up with the audio crossfade centres.
  const vparts = segs.map((s, i) => {
    if (i === segs.length - 1) return `[v${i}]`;
    f.push(`[v${i}]trim=duration=${(dur(s) - XF).toFixed(4)},setpts=PTS-STARTPTS[vt${i}]`);
    return `[vt${i}]`;
  });
  f.push(`${vparts.join('')}concat=n=${segs.length}:v=1:a=0[vc]`);
  let ap = 'a0';
  for (let i = 1; i < segs.length; i++) { f.push(`[${ap}][a${i}]acrossfade=d=${XF}:c1=tri:c2=tri[ax${i}]`); ap = `ax${i}`; }
  // glitch at selected cuts (RGB split + noise + smear, ~0.25 s)
  const gl = segs.map((s, i) => (s[3] && i > 0 ? starts[i] : null)).filter((t) => t !== null && t < total - 3);
  const en = gl.map((t) => `between(t,${(t - 0.1).toFixed(3)},${(t + 0.14).toFixed(3)})`).join('+');
  f.push(`[vc]rgbashift=rh=-16:bh=16:gv=4:enable='${en}',noise=alls=36:allf=t:enable='${en}',gblur=sigma=7:sigmaV=0.01:enable='${en}'[vg]`);
  // title flash over the cold open: the game's own title card, screen-blended (black = transparent)
  const td = TITLE[2] - TITLE[1];
  f.push(`[${vi('Z')}:v]trim=start=${TITLE[1]}:end=${TITLE[2]},setpts=PTS-STARTPTS,fps=${FPS},${frame(true)},format=yuv420p,setsar=1,lutyuv=y='clip((val-18)*2.2,0,255)',`
    + `fade=t=in:st=0:d=0.12,fade=t=out:st=${(td - 0.35).toFixed(2)}:d=0.35,tpad=start_duration=${TITLE_AT}:stop_duration=${(total).toFixed(2)}:color=black[tt]`);
  f.push(`[vg][tt]blend=all_mode=screen:shortest=1,fade=t=out:st=${(total - 0.5).toFixed(3)}:d=0.5,format=yuv420p[vout]`);
  f.push(`[${ap}]afade=t=in:st=0:d=0.05,afade=t=out:st=${(total - 0.7).toFixed(3)}:d=0.7,loudnorm=I=-14:TP=-1.0:LRA=9,aresample=48000[aout]`);
  execFileSync('ffmpeg', [...args, '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-maxrate', '16M', '-bufsize', '32M', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-g', '60', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', out], { stdio: 'inherit' });
}

build(false, 'shots/demo/cold-boot-reel.mp4');
build(true, 'shots/demo/cold-boot-reel-vertical.mp4');
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'shots/demo/cold-boot-reel.mp4', '-vf', 'fps=2,scale=400:-1,tile=8x10:padding=4', '-frames:v', '1', 'shots/demo/contact-reel.png'], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', 'shots/demo/cold-boot-reel-vertical.mp4', '-vf', 'fps=1,scale=180:-1,tile=10x4:padding=4', '-frames:v', '1', 'shots/demo/contact-reel-vertical.png'], { stdio: 'inherit' });
console.log('cuts:');
segs.forEach((s, i) => console.log(`  ${starts[i].toFixed(2).padStart(5)}–${(starts[i] + dur(s) - (i < segs.length - 1 ? XF : 0)).toFixed(2).padStart(5)}  ${s[0]} ${s[1]}–${s[2]}${s[3] ? '  (glitch)' : ''}`));
console.log(`total ${total.toFixed(2)} s`);
