/**
 * Synthesized battle sounds via WebAudio — zero assets, zero licensing.
 * Each effect is a tiny oscillator/noise recipe. The AudioContext is created
 * lazily on first use (battles start from a click, so autoplay policy is
 * satisfied). All volumes are deliberately modest.
 */

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(next: boolean): void {
  muted = next;
}

export function isMuted(): boolean {
  return muted;
}

function env(a: AudioContext, gain: number, duration: number, attack = 0.005): GainNode {
  const g = a.createGain();
  const t = a.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  g.connect(a.destination);
  return g;
}

function tone(
  a: AudioContext,
  type: OscillatorType,
  fromHz: number,
  toHz: number,
  duration: number,
  gain: number,
  delay = 0,
): void {
  const osc = a.createOscillator();
  osc.type = type;
  const t = a.currentTime + delay;
  osc.frequency.setValueAtTime(fromHz, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), t + duration);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  g.connect(a.destination);
  osc.connect(g);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(a: AudioContext, duration: number, gain: number, filterHz: number, filterType: BiquadFilterType = "lowpass"): void {
  const frames = Math.max(1, Math.floor(a.sampleRate * duration));
  const buffer = a.createBuffer(1, frames, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterHz;
  src.connect(filter);
  filter.connect(env(a, gain, duration));
  src.start();
}

export const sfx = {
  /** Projectile launch — airy whoosh. */
  whoosh(): void {
    if (muted) return;
    const a = ac();
    if (!a) return;
    noise(a, 0.18, 0.1, 1400, "bandpass");
    tone(a, "sine", 700, 220, 0.16, 0.05);
  },

  /** Melee/projectile impact — low thud + crack. */
  hit(): void {
    if (muted) return;
    const a = ac();
    if (!a) return;
    tone(a, "sine", 150, 45, 0.16, 0.22);
    noise(a, 0.08, 0.12, 2600);
  },

  /** Critical hit — heavier thud with a bright ring. */
  crit(): void {
    if (muted) return;
    const a = ac();
    if (!a) return;
    tone(a, "sine", 190, 38, 0.24, 0.3);
    noise(a, 0.12, 0.18, 3200);
    tone(a, "square", 880, 440, 0.14, 0.05, 0.02);
  },

  /** Shield soak — dull metallic thunk (kept low so it doesn't pierce). */
  shield(): void {
    if (muted) return;
    const a = ac();
    if (!a) return;
    tone(a, "sine", 340, 240, 0.13, 0.16);
    tone(a, "triangle", 620, 480, 0.09, 0.05, 0.005);
    noise(a, 0.06, 0.05, 900, "bandpass");
  },

  /** Buff/heal — quick ascending sparkle. */
  buff(): void {
    if (muted) return;
    const a = ac();
    if (!a) return;
    tone(a, "sine", 520, 780, 0.09, 0.08);
    tone(a, "sine", 780, 1170, 0.09, 0.08, 0.07);
  },

  /** Direct-damage ability — arcane zap. */
  zap(): void {
    if (muted) return;
    const a = ac();
    if (!a) return;
    tone(a, "sawtooth", 900, 120, 0.16, 0.08);
    noise(a, 0.1, 0.06, 4000, "highpass");
  },

  /** Unit faints — sad descending blip. */
  faint(): void {
    if (muted) return;
    const a = ac();
    if (!a) return;
    tone(a, "triangle", 420, 110, 0.3, 0.1);
  },

  /** Victory fanfare — little major arpeggio. */
  fanfare(): void {
    if (muted) return;
    const a = ac();
    if (!a) return;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    notes.forEach((f, i) => tone(a, "triangle", f, f, 0.32, 0.11, i * 0.11));
    noise(a, 0.5, 0.03, 6000, "highpass");
  },

  /** Defeat — low minor drone. */
  defeat(): void {
    if (muted) return;
    const a = ac();
    if (!a) return;
    tone(a, "triangle", 220, 220, 0.5, 0.09);
    tone(a, "triangle", 261.6, 246.9, 0.55, 0.07, 0.05);
    tone(a, "sine", 110, 82, 0.7, 0.1, 0.1);
  },
};
