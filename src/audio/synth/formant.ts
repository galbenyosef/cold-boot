/**
 * Formant "speech" without speech assets: text → syllable plan (cadence, vowel colours, consonant
 * noise / gaps) → glottal pulse source through a bank of band-pass formant filters whose centre
 * frequencies glide between vowel targets. Used by the CHOIR voice, husk vocalisers and distant murmurs.
 */
import { Synth, periodic } from './core';

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'ə' | 'm';
type Fric = 's' | 'sh' | 'f' | 'h';

// Adult (male-ish) formants F1..F4 and relative amplitudes.
const VOWELS: Record<Vowel, [number, number, number, number]> = {
  a: [730, 1090, 2440, 3400],
  e: [530, 1840, 2480, 3500],
  i: [290, 2250, 3000, 3700],
  o: [570, 840, 2410, 3300],
  u: [320, 870, 2240, 3300],
  ə: [500, 1500, 2500, 3400],
  m: [260, 1000, 2200, 3200], // nasal murmur
};

export interface Seg {
  t: number;
  dur: number;
  kind: 'v' | 'gap' | 'fric' | 'nasal' | 'liquid';
  vowel: Vowel;
  vowel2?: Vowel;
  fric?: Fric;
  /** Plosive burst at the end of a gap. */
  burst?: boolean;
  accent: number;
  /** 0..1 position within the phrase (for the falling contour). */
  pos: number;
  phraseEnd: boolean;
}

export interface Plan { segs: Seg[]; length: number; }

const VOWEL_OF: Record<string, Vowel> = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i' };

function vowelGroup(g: string): [Vowel, Vowel | undefined] {
  const special: Record<string, [Vowel, Vowel | undefined]> = {
    ee: ['i', undefined], ea: ['i', undefined], oo: ['u', undefined], ou: ['a', 'u'], ow: ['a', 'u'],
    ai: ['e', 'i'], ay: ['e', 'i'], oi: ['o', 'i'], oy: ['o', 'i'], ie: ['a', 'i'], ue: ['u', undefined],
    io: ['i', 'o'], ia: ['i', 'ə'], au: ['o', undefined], ei: ['e', 'i'], eo: ['i', 'o'],
  };
  if (special[g.slice(0, 2)]) return special[g.slice(0, 2)];
  const v = VOWEL_OF[g[0]] ?? 'ə';
  // unstressed 'e' at the end reads as schwa
  return [v, g.length > 1 ? VOWEL_OF[g[g.length - 1]] : undefined];
}

function consonantSegs(cons: string): Array<Pick<Seg, 'kind' | 'fric' | 'burst' | 'dur'>> {
  const out: Array<Pick<Seg, 'kind' | 'fric' | 'burst' | 'dur'>> = [];
  for (let i = 0; i < cons.length; i++) {
    const c = cons[i], c2 = cons.slice(i, i + 2);
    if (c2 === 'sh' || c2 === 'ch' || c2 === 'th') {
      out.push({ kind: 'fric', fric: c2 === 'th' ? 'f' : 'sh', dur: 0.075 }); i++; continue;
    }
    if ('szcx'.includes(c)) out.push({ kind: 'fric', fric: 's', dur: 0.08 });
    else if ('fv'.includes(c)) out.push({ kind: 'fric', fric: 'f', dur: 0.06 });
    else if (c === 'h') out.push({ kind: 'fric', fric: 'h', dur: 0.05 });
    else if ('ptkbdgqj'.includes(c)) out.push({ kind: 'gap', burst: true, dur: 0.055 });
    else if ('mn'.includes(c)) out.push({ kind: 'nasal', dur: 0.065 });
    else if ('lrw'.includes(c)) out.push({ kind: 'liquid', dur: 0.045 });
  }
  return out;
}

/** Turn text into a timed segment plan of roughly `duration` seconds (0 = natural length). */
export function planText(text: string, duration: number, rnd: () => number): Plan {
  const tokens = text.toLowerCase().replace(/[^a-z.,!?;:…\s'-]/g, ' ').match(/[a-z']+|[.,!?;:…]/g) ?? ['hm'];
  type Raw = Omit<Seg, 't' | 'pos' | 'phraseEnd'> & { weight: number; pause?: boolean };
  const raw: Raw[] = [];
  const phraseBreaks: number[] = [];
  for (const tok of tokens) {
    if (/^[.,!?;:…]$/.test(tok)) {
      const d = tok === ',' ? 0.22 : tok === '…' ? 0.55 : 0.42;
      raw.push({ kind: 'gap', vowel: 'ə', dur: d, accent: 0, weight: 0, pause: true });
      phraseBreaks.push(raw.length - 1);
      continue;
    }
    const word = tok.replace(/'/g, '');
    const sylls = word.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$)?/g) ?? [word];
    sylls.forEach((sy, si) => {
      const m = sy.match(/^([^aeiouy]*)([aeiouy]+)([^aeiouy]*)$/);
      const onset = m ? m[1] : sy, nuc = m ? m[2] : 'e', coda = m ? m[3] : '';
      for (const c of consonantSegs(onset)) raw.push({ ...c, vowel: 'ə', accent: 0, weight: 0 });
      const [v1, v2] = vowelGroup(nuc);
      const accent = si === 0 ? 1 : 0;
      raw.push({ kind: 'v', vowel: v1, vowel2: v2, dur: 0, accent, weight: (accent ? 1.2 : 0.9) * (nuc.length > 1 ? 1.25 : 1) });
      for (const c of consonantSegs(coda)) raw.push({ ...c, vowel: 'ə', accent: 0, weight: 0 });
    });
    raw.push({ kind: 'gap', vowel: 'ə', dur: 0.035, accent: 0, weight: 0 });
  }
  // lengthen the last vowel before each phrase break and at the very end
  const lastVowelBefore = (idx: number) => { for (let i = Math.min(idx, raw.length - 1); i >= 0; i--) if (raw[i].kind === 'v') return i; return -1; };
  for (const b of [...phraseBreaks, raw.length - 1]) { const i = lastVowelBefore(b); if (i >= 0) raw[i].weight *= 1.7; }

  const fixed = raw.reduce((a, r) => a + (r.kind === 'v' ? 0 : r.dur), 0);
  const W = raw.reduce((a, r) => a + r.weight, 0) || 1;
  const target = duration > 0 ? duration * 0.94 : fixed + W * 0.17;
  let unit = (target - fixed) / W;
  let scale = 1;
  if (unit < 0.07) { unit = 0.07; scale = target / (fixed + W * unit); }
  unit = Math.min(unit, 0.42);
  let t = 0;
  const segs: Seg[] = [];
  // phrase ranges for the contour
  let phraseStart = 0;
  const ends = [...phraseBreaks, raw.length];
  let pIdx = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    while (pIdx < ends.length && i > ends[pIdx]) { phraseStart = ends[pIdx] + 1; pIdx++; }
    const pEnd = ends[Math.min(pIdx, ends.length - 1)];
    const pos = (i - phraseStart) / Math.max(1, pEnd - phraseStart);
    const dur = (r.kind === 'v' ? r.weight * unit * (0.9 + rnd() * 0.2) : r.dur) * scale;
    segs.push({ t, dur, kind: r.kind, vowel: r.vowel, vowel2: r.vowel2, fric: r.fric, burst: r.burst, accent: r.accent, pos, phraseEnd: i === pEnd - 1 || i === lastVowelBefore(pEnd) });
    t += dur;
  }
  return { segs, length: t };
}

export interface VoiceOpts {
  f0: number;
  /** Formant frequency scale (1 adult male, ~1.35 child). */
  fscale: number;
  level: number;
  /** Seconds offset of this voice against the plan. */
  delay: number;
  /** Random per-segment timing jitter (s). */
  jitter: number;
  /** Semitones of contour range. */
  contour: number;
  /** 'calm' falls; 'cheerful' rises then falls (service-android politeness). */
  style: 'calm' | 'cheerful' | 'flat';
  vibrato: number;
  /** 0 = voiced only, 1 = whisper (noise source). */
  breath: number;
  dst: AudioNode;
  /** Use a raw sawtooth (harsher, more synthetic) instead of the glottal wave. */
  saw?: boolean;
  /** Random pitch jumps per segment (semitones, glitchy vocalisers). */
  pitchJumps?: number;
}

/** Build one formant voice following `plan` into synth `s` (offline or live context). */
export function buildVoice(s: Synth, plan: Plan, o: VoiceOpts): void {
  const T = plan.length + 0.4;
  const t0 = o.delay;
  const ctx = s.ctx;
  const amp = s.gain(0);
  const formantGains = [1, 0.55, 0.28, 0.12];
  const bws = [90, 120, 170, 250];
  const filters: BiquadFilterNode[] = [];
  const sum = s.gain(o.level);
  for (let k = 0; k < 4; k++) {
    const f = s.bp(VOWELS.ə[k] * o.fscale, 1);
    f.Q.value = (VOWELS.ə[k] * o.fscale) / (bws[k] * Math.sqrt(o.fscale));
    const g = s.gain(formantGains[k] * (k === 0 ? 1 : 1.6));
    amp.connect(f); f.connect(g); g.connect(sum);
    filters.push(f);
  }
  sum.connect(o.dst);

  // source(s)
  if (o.breath < 1) {
    const wave = o.saw ? undefined : periodic(ctx, 'glottal', (n) => Math.pow(n, -1.15) * (n % 2 ? 1 : 0.8));
    const osc = s.osc(o.saw ? 'sawtooth' : 'sine', o.f0, t0, T, wave);
    const vg = s.gain(1 - o.breath);
    osc.connect(vg); vg.connect(amp);
    // vibrato
    if (o.vibrato > 0) {
      const lfo = s.osc('sine', 4.6 + s.rnd() * 0.8, t0, T);
      const lg = s.gain(o.f0 * o.vibrato);
      lfo.connect(lg); lg.connect(osc.frequency);
    }
    // pitch contour
    const f = osc.frequency;
    f.setValueAtTime(o.f0, s.at(t0));
    for (const seg of plan.segs) {
      if (seg.kind !== 'v' && seg.kind !== 'nasal' && seg.kind !== 'liquid') continue;
      let semi: number;
      if (o.style === 'calm') semi = o.contour * (0.6 - seg.pos) + seg.accent * 0.9 - (seg.phraseEnd ? o.contour * 0.5 : 0);
      else if (o.style === 'cheerful') semi = o.contour * Math.sin(seg.pos * Math.PI) + seg.accent * 2 + (seg.phraseEnd ? o.contour * 0.6 : 0);
      else semi = seg.accent * 0.5;
      if (o.pitchJumps && s.chance(0.35)) semi += (s.rnd() * 2 - 1) * o.pitchJumps;
      const tt = t0 + seg.t + (s.rnd() * 2 - 1) * o.jitter;
      f.setTargetAtTime(o.f0 * Math.pow(2, semi / 12), s.at(tt), o.pitchJumps ? 0.004 : 0.045);
    }
  }
  if (o.breath > 0) {
    const n = s.noise('pink', t0, T);
    const ng = s.gain(o.breath * 2.2);
    n.connect(ng); ng.connect(amp);
  }

  // amplitude + formant automation
  const A = amp.gain;
  A.setValueAtTime(0, s.at(0));
  for (const seg of plan.segs) {
    const tt = t0 + seg.t + (s.rnd() * 2 - 1) * o.jitter;
    let lvl = 0, ftarget: Vowel | null = null;
    switch (seg.kind) {
      case 'v': lvl = 0.85 + seg.accent * 0.15; ftarget = seg.vowel; break;
      case 'nasal': lvl = 0.35; ftarget = 'm'; break;
      case 'liquid': lvl = 0.5; ftarget = 'u'; break;
      case 'fric': lvl = seg.fric === 'h' ? 0.15 : 0.03; break;
      case 'gap': lvl = 0; break;
    }
    A.setTargetAtTime(lvl, s.at(tt), lvl > 0 ? 0.018 : 0.012);
    if (ftarget) {
      const vf = VOWELS[ftarget];
      for (let k = 0; k < 4; k++) filters[k].frequency.setTargetAtTime(vf[k] * o.fscale, s.at(tt), 0.028);
      if (seg.vowel2) {
        const v2 = VOWELS[seg.vowel2];
        for (let k = 0; k < 4; k++) filters[k].frequency.setTargetAtTime(v2[k] * o.fscale, s.at(tt + seg.dur * 0.55), 0.04);
      }
    }
  }
  A.setTargetAtTime(0, s.at(t0 + plan.length), 0.05);
}

/** Consonant noise layer (fricatives + plosive bursts), shared by all voices of a choir. */
export function buildConsonants(s: Synth, plan: Plan, level: number, dst: AudioNode, delay = 0): void {
  const T = plan.length + 0.3;
  const n = s.noise('white', delay, T);
  const branches: Record<'s' | 'sh' | 'f' | 'h' | 'b', GainNode> = {
    s: s.gain(0), sh: s.gain(0), f: s.gain(0), h: s.gain(0), b: s.gain(0),
  };
  s.chain(n, s.hp(4800, 0.9), branches.s, dst);
  s.chain(n, s.bp(2600, 1.6), branches.sh, dst);
  s.chain(n, s.bp(1600, 0.4), branches.f, dst);
  s.chain(n, s.bp(1200, 0.7), branches.h, dst);
  s.chain(n, s.bp(2200, 0.9), branches.b, dst);
  for (const seg of plan.segs) {
    const tt = delay + seg.t;
    if (seg.kind === 'fric' && seg.fric) {
      const g = branches[seg.fric].gain;
      const pk = level * (seg.fric === 's' ? 0.45 : seg.fric === 'sh' ? 0.5 : seg.fric === 'h' ? 0.25 : 0.3);
      g.setTargetAtTime(pk, s.at(tt), 0.012);
      g.setTargetAtTime(0, s.at(tt + seg.dur * 0.8), 0.015);
    }
    if (seg.burst) {
      const g = branches.b.gain;
      g.setTargetAtTime(level * 0.5, s.at(tt + seg.dur - 0.012), 0.002);
      g.setTargetAtTime(0, s.at(tt + seg.dur), 0.008);
    }
  }
}
