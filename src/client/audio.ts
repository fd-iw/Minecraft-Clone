import type { SoundGroup } from '../engine/blocks';

interface Voice {
  /** Band-pass centre frequency (Hz) of the noise burst. */
  freq: number;
  q: number;
  /** Seconds. */
  length: number;
  /** Optional pitched body under the noise (Hz). */
  tone?: number;
  gain: number;
}

// Each material gets its own small recipe: filtered noise plus an optional tonal thump.
const MATERIALS: Record<SoundGroup, Voice> = {
  stone: { freq: 1400, q: 1.2, length: 0.12, tone: 180, gain: 0.5 },
  wood: { freq: 700, q: 2.5, length: 0.14, tone: 240, gain: 0.55 },
  gravel: { freq: 2200, q: 0.8, length: 0.16, gain: 0.45 },
  grass: { freq: 3000, q: 0.7, length: 0.12, gain: 0.35 },
  sand: { freq: 4200, q: 0.6, length: 0.14, gain: 0.3 },
  glass: { freq: 5200, q: 6, length: 0.18, tone: 1760, gain: 0.35 },
  wool: { freq: 900, q: 0.6, length: 0.12, gain: 0.3 },
  snow: { freq: 2600, q: 0.5, length: 0.14, gain: 0.3 },
  none: { freq: 1000, q: 1, length: 0.05, gain: 0 },
};

/** Tiny procedural sound engine. The audio context starts on the first user gesture. */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.6;

  constructor(private readonly enabled: boolean) {
    if (!enabled) return;
    const start = (): void => {
      this.ensure();
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        d[i] = (seed / 4294967296) * 2 - 1;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Plays a material sound; `kind` shapes its envelope. */
  play(group: SoundGroup, kind: 'break' | 'place' | 'step', volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || ctx.state !== 'running') return;
    const v = MATERIALS[group];
    if (v.gain === 0) return;
    const now = ctx.currentTime;
    const scale = kind === 'break' ? 1.3 : kind === 'place' ? 1 : 0.45;
    const len = v.length * (kind === 'step' ? 0.7 : kind === 'break' ? 1.4 : 1);
    const pitch = 0.85 + Math.random() * 0.3;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = v.freq * pitch;
    filter.Q.value = v.q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(v.gain * scale * volume, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, now + len);
    src.connect(filter).connect(env).connect(this.master);
    src.start(now, Math.random() * 0.8);
    src.stop(now + len + 0.02);

    if (v.tone && kind !== 'step') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(v.tone * pitch, now);
      osc.frequency.exponentialRampToValueAtTime(v.tone * pitch * 0.5, now + len);
      const og = ctx.createGain();
      og.gain.setValueAtTime(v.gain * 0.5 * scale * volume, now);
      og.gain.exponentialRampToValueAtTime(0.001, now + len);
      osc.connect(og).connect(this.master);
      osc.start(now);
      osc.stop(now + len + 0.02);
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
