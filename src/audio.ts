// WebAudio chip-synth. One tune, arranged per tier:
// T0/T1 in-game: SFX only (beeper). T2: AY-style 3ch square. T3: smoother voices.
// T4: + drums. T5: stereo, detune, harmony — "MOD" richness.

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let musicTier = 1;
let titleMode = true;

const STEP = 0.135;
let nextNote = 0;
let step = 0;

// E-minor pentatonic folk loop, 32 x 16th steps. 0 = rest.
const MEL = [
  64, 0, 67, 0, 69, 0, 71, 0, 74, 0, 71, 0, 69, 0, 67, 0,
  64, 0, 67, 69, 71, 0, 74, 76, 74, 0, 71, 69, 67, 0, 64, 0,
];
const BASS = [
  40, 0, 0, 0, 40, 0, 0, 0, 45, 0, 0, 0, 43, 0, 0, 0,
  40, 0, 0, 0, 40, 0, 0, 0, 38, 0, 0, 0, 43, 0, 0, 0,
];
// Bridge section: higher contour, different roots. Arrangement is A A B A.
const MEL_B = [
  76, 0, 74, 0, 71, 0, 69, 0, 71, 0, 74, 0, 76, 0, 79, 0,
  76, 0, 74, 0, 71, 0, 69, 0, 67, 0, 69, 0, 64, 0, 0, 0,
];
const BASS_B = [
  45, 0, 0, 0, 45, 0, 0, 0, 43, 0, 0, 0, 43, 0, 0, 0,
  45, 0, 0, 0, 40, 0, 0, 0, 38, 0, 0, 0, 40, 0, 0, 0,
];

const freq = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export function initAudio(): void {
  if (ac) return;
  ac = new AudioContext();
  master = ac.createGain();
  master.gain.value = 0.5;
  master.connect(ac.destination);
  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  nextNote = ac.currentTime + 0.1;
  setInterval(schedule, 60);
}

export function setMusicTier(t: number): void { musicTier = t; }
export function setTitleMode(b: boolean): void { titleMode = b; }

function out(pan: number): AudioNode {
  if (!ac || !master) throw new Error('no audio');
  if (pan === 0) return master;
  const p = ac.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(master);
  return p;
}

function tone(
  f0: number, f1: number, dur: number, type: OscillatorType, vol: number, pan = 0, at = 0,
): void {
  if (!ac) return;
  const t0 = ac.currentTime + at;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f0), t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
  o.connect(g).connect(out(pan));
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, filterFreq: number, kind: BiquadFilterType, vol: number, pan = 0, at = 0): void {
  if (!ac || !noiseBuf) return;
  const t0 = ac.currentTime + at;
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = kind;
  f.frequency.value = filterFreq;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
  s.connect(f).connect(g).connect(out(pan));
  s.start(t0, Math.random(), dur + 0.05);
}

function noteAt(t: number, f: number, dur: number, type: OscillatorType, vol: number, pan = 0): void {
  if (!ac) return;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = f;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
  o.connect(g).connect(out(pan));
  o.start(t);
  o.stop(t + dur + 0.02);
}

function drumAt(t: number, kind: 'kick' | 'snare' | 'hat'): void {
  if (!ac || !noiseBuf) return;
  if (kind === 'kick') {
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(out(0));
    o.start(t); o.stop(t + 0.14);
    return;
  }
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = kind === 'snare' ? 1800 : 6000;
  const g = ac.createGain();
  const vol = kind === 'snare' ? 0.12 : 0.04;
  const dur = kind === 'snare' ? 0.08 : 0.03;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(out(kind === 'hat' ? 0.2 : 0));
  s.start(t, Math.random(), dur + 0.02);
}

function schedule(): void {
  if (!ac) return;
  while (nextNote < ac.currentTime + 0.16) {
    stepAt(step, nextNote);
    step = (step + 1) % 128;   // 4 sections of 32: A A B A
    nextNote += STEP;
  }
}

function stepAt(absStep: number, t: number): void {
  const s = absStep % 32;
  const bridge = Math.floor(absStep / 32) === 2;
  const mel = bridge ? MEL_B : MEL;
  const bass = bridge ? BASS_B : BASS;
  if (titleMode) {
    // Monophonic beeper: melody, else bass filling gaps — classic 48K trick.
    const n = mel[s] || (s % 4 === 0 ? bass[s] + 24 : 0);
    if (n) noteAt(t, freq(n), 0.11, 'square', 0.1);
    return;
  }
  const tier = musicTier;
  if (tier < 2) return;
  const m = mel[s];
  const b = bass[s];
  const melType: OscillatorType = tier >= 4 ? 'sawtooth' : 'square';
  const melVol = tier >= 4 ? 0.055 : 0.07;
  if (m) {
    noteAt(t, freq(m), 0.12, melType, melVol, tier >= 5 ? 0.3 : 0);
    if (tier >= 5) {
      noteAt(t, freq(m) * 1.004, 0.12, melType, melVol * 0.7, -0.3);  // detuned pair
      noteAt(t, freq(m - 12), 0.24, 'triangle', 0.03, -0.15);         // harmony voice
    }
  }
  if (b) noteAt(t, freq(b), tier >= 3 ? 0.3 : 0.13, tier >= 3 ? 'triangle' : 'square', tier >= 3 ? 0.14 : 0.09);
  if (tier >= 3 && s % 4 === 2) noteAt(t, freq(bass[Math.floor(s / 4) * 4] + 12), 0.08, 'square', 0.025, 0.15);
  if (tier >= 4) {
    if (s % 8 === 0) drumAt(t, 'kick');
    if (s % 8 === 4) drumAt(t, 'snare');
    if (s % 2 === 1) drumAt(t, 'hat');
  }
}

export type SfxName =
  'step' | 'zap' | 'hit' | 'pickup' | 'derez' | 'upgrade' | 'ritual' | 'deny'
  | 'spawn' | 'berry' | 'freeze' | 'wand';

export function sfx(name: SfxName, tier: number, vol = 1, pan = 0): void {
  if (!ac || vol <= 0.01) return;
  switch (name) {
    case 'step':
      if (tier <= 1) tone(1900, 1500, 0.014, 'square', 0.05 * vol, pan);
      else if (tier <= 3) noise(0.02, 3400, 'highpass', 0.05 * vol, pan);
      else noise(0.045, 1100, 'lowpass', 0.1 * vol, pan);
      break;
    case 'zap':
      if (tier <= 1) tone(1300, 160, 0.16, 'square', 0.2 * vol, pan);
      else if (tier <= 2) { tone(1300, 160, 0.16, 'square', 0.16 * vol, pan); tone(1320, 170, 0.16, 'square', 0.1 * vol, pan); }
      else if (tier <= 3) { tone(1100, 120, 0.18, 'sawtooth', 0.16 * vol, pan); noise(0.06, 2500, 'highpass', 0.05 * vol, pan); }
      else { tone(1000, 90, 0.22, 'sawtooth', 0.16 * vol, pan); noise(0.12, 1800, 'bandpass', 0.1 * vol, pan); }
      break;
    case 'hit':
      tone(300, 80, 0.12, 'square', 0.18 * vol, pan);
      if (tier >= 2) noise(0.08, 900, 'lowpass', 0.14 * vol, pan);
      break;
    case 'pickup': {
      const w: OscillatorType = tier >= 3 ? 'triangle' : 'square';
      tone(660, 660, 0.06, w, 0.12 * vol, pan);
      tone(880, 880, 0.06, w, 0.12 * vol, pan, 0.07);
      tone(1320, 1320, 0.1, w, 0.12 * vol, pan, 0.14);
      break;
    }
    case 'derez':
      tone(700, 50, 0.8, 'square', 0.2 * vol, pan);
      noise(0.7, 1200, 'lowpass', 0.18 * vol, pan);
      break;
    case 'upgrade':
      tone(220, 1760, 0.7, tier >= 4 ? 'sawtooth' : 'square', 0.14 * vol, pan);
      tone(330, 2640, 0.7, 'square', 0.08 * vol, pan, 0.05);
      if (tier >= 3) noise(0.6, 4000, 'highpass', 0.05 * vol, pan, 0.2);
      break;
    case 'ritual':
      tone(500 + tier * 60, 700 + tier * 60, 0.08, 'square', 0.09 * vol, pan);
      break;
    case 'deny':
      tone(150, 110, 0.18, 'square', 0.14 * vol, pan);
      break;
    case 'spawn':
      tone(1200, 1900, 0.12, 'triangle', 0.06 * vol, pan);
      break;
    case 'freeze':
      tone(2200, 400, 0.4, 'triangle', 0.14 * vol, pan);
      noise(0.3, 5000, 'highpass', 0.06 * vol, pan);
      break;
    case 'wand':
      tone(440, 440, 0.07, 'square', 0.1 * vol, pan);
      tone(660, 660, 0.07, 'square', 0.1 * vol, pan, 0.08);
      tone(880, 880, 0.12, 'square', 0.1 * vol, pan, 0.16);
      break;
    case 'berry': {
      const w2: OscillatorType = tier >= 3 ? 'triangle' : 'square';
      tone(520, 520, 0.05, w2, 0.1 * vol, pan);
      tone(780, 780, 0.09, w2, 0.1 * vol, pan, 0.06);
      break;
    }
  }
}
