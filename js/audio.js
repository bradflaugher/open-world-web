// Generative Eno-style ambient Web Audio synthesizer for Open World.
// Prime-length pentatonic loops per biome, a soft breathing drone, harmonic
// beacon tones, and gentle tactile SFX — zero external audio files.

import { BIOME } from './world.js';

// Pentatonic / modal frequencies (Hz) per biome
const SCALES = {
  [BIOME.MEADOW]: [261.63, 293.66, 329.63, 392.0, 440.0, 523.25], // C major pentatonic
  [BIOME.SHORE]: [293.66, 329.63, 392.0, 440.0, 523.25, 587.33], // D dorian pentatonic
  [BIOME.FOREST]: [220.0, 261.63, 293.66, 329.63, 392.0, 440.0], // A minor pentatonic
  [BIOME.TUNDRA]: [246.94, 293.66, 329.63, 369.99, 440.0, 493.88], // B minor / crystalline
  [BIOME.DESERT]: [293.66, 311.13, 392.0, 440.0, 466.16, 587.33], // D phrygian color
  [BIOME.ROCK]: [196.0, 220.0, 261.63, 293.66, 329.63, 392.0], // G sparse
  [BIOME.ASH]: [196.0, 233.08, 261.63, 293.66, 349.23, 392.0], // G minor
  [BIOME.RUINS]: [220.0, 246.94, 293.66, 329.63, 392.0, 440.0], // A suspended
};

const DRONES = {
  [BIOME.MEADOW]: 130.81,
  [BIOME.SHORE]: 146.83,
  [BIOME.FOREST]: 110.0,
  [BIOME.TUNDRA]: 123.47,
  [BIOME.DESERT]: 146.83,
  [BIOME.ROCK]: 98.0,
  [BIOME.ASH]: 98.0,
  [BIOME.RUINS]: 110.0,
};

// Prime-length loop periods (seconds) so phrases never repeat in sync
const LOOP_PERIODS = [5.0, 7.0, 11.0, 13.0];

export class SoundEngine {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.master = null;
    this.droneOsc = null;
    this.droneGain = null;
    this._suspended = false;
    this.timers = LOOP_PERIODS.map((p, i) => p * (0.25 + i * 0.2));
    this.stepIdx = [0, 2, 4, 1];
    this.currentBiome = BIOME.MEADOW;
  }

  _isHidden() {
    return typeof document !== 'undefined' && Boolean(document.hidden);
  }

  unlock() {
    if (!this.enabled || this._suspended || this._isHidden()) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.28;
        this.master.connect(this.ctx.destination);

        // Soft breathing biome drone
        this.droneOsc = this.ctx.createOscillator();
        this.droneOsc.type = 'sine';
        this.droneOsc.frequency.value = 130.81;
        this.droneGain = this.ctx.createGain();
        this.droneGain.gain.value = 0.045;
        this.droneOsc.connect(this.droneGain).connect(this.master);
        this.droneOsc.start();
      }
      if (this.master) {
        this.master.gain.setTargetAtTime(0.28, this.ctx.currentTime, 0.05);
      }
      if (this.ctx.state === 'suspended') {
        Promise.resolve(this.ctx.resume()).catch(() => {});
      }
    } catch {
      // AudioContext unavailable or blocked
    }
  }

  suspend() {
    this._suspended = true;
    if (!this.ctx) return;
    try {
      if (this.master) {
        const now = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues?.(now);
        this.master.gain.setTargetAtTime(0.0001, now, 0.015);
      }
      if (this.ctx.state === 'running') {
        Promise.resolve(this.ctx.suspend()).catch(() => {});
      }
    } catch {
      // Ignore suspend errors
    }
  }

  resume() {
    this._suspended = false;
    if (!this.enabled || this._isHidden() || !this.ctx) return;
    try {
      if (this.master) {
        const now = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues?.(now);
        this.master.gain.setTargetAtTime(0.28, now, 0.05);
      }
      if (this.ctx.state === 'suspended') {
        Promise.resolve(this.ctx.resume()).catch(() => {});
      }
    } catch {
      // Ignore resume errors
    }
  }

  setEnabled(on) {
    this.enabled = Boolean(on);
    if (!this.enabled) {
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.03);
      }
      if (this.ctx && this.ctx.state === 'running') {
        Promise.resolve(this.ctx.suspend()).catch(() => {});
      }
      return;
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(0.28, this.ctx.currentTime, 0.08);
    }
    this.unlock();
  }

  _note(freq, dur = 0.6, type = 'triangle', vol = 0.09, delay = 0) {
    if (!this.enabled || this._suspended || this._isHidden() || !this.ctx || !this.master) return;
    try {
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(vol, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + dur + 0.03);
    } catch {
      // Ignore scheduling errors
    }
  }

  update(dt, biome, litBeacons) {
    if (!this.enabled || this._suspended || this._isHidden() || !this.ctx || this.ctx.state !== 'running') return;
    this.currentBiome = biome;
    const targetFreq = DRONES[biome] || 130.81;
    if (this.droneOsc) {
      this.droneOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 1.5);
    }
    const scale = SCALES[biome] || SCALES[BIOME.MEADOW];
    const activeVoices = Math.min(LOOP_PERIODS.length, 1 + litBeacons);
    for (let i = 0; i < activeVoices; i++) {
      this.timers[i] -= dt;
      if (this.timers[i] <= 0) {
        this.timers[i] = LOOP_PERIODS[i];
        const idx = (this.stepIdx[i] + i + 1) % scale.length;
        this.stepIdx[i] = idx;
        const f = scale[idx] * (i === 3 ? 2 : 1);
        this._note(f, 1.6 + i * 0.3, i === 0 ? 'sine' : 'triangle', 0.045, 0);
        // Gentle echo (Channel 2 homage)
        this._note(f, 1.2, 'sine', 0.02, 0.42);
      }
    }
  }

  handleEvent(ev) {
    if (!this.enabled || this._suspended || this._isHidden()) return;
    this.unlock();
    switch (ev.type) {
      case 'step':
        this._note(115 + Math.random() * 25, 0.055, 'sine', 0.025);
        break;
      case 'fire-lit':
        this._note(329.63, 0.25, 'triangle', 0.08, 0);
        this._note(440.0, 0.4, 'triangle', 0.08, 0.09);
        break;
      case 'bramble-burnt':
        this._note(220, 0.14, 'sawtooth', 0.045, 0);
        this._note(330, 0.2, 'triangle', 0.05, 0.06);
        break;
      case 'beacon-lit':
        [261.63, 329.63, 392.0, 523.25, 659.25].forEach((f, i) => {
          this._note(f, 0.9, 'triangle', 0.09, i * 0.11);
        });
        break;
      case 'item-found':
        [392.0, 493.88, 587.33, 783.99].forEach((f, i) => {
          this._note(f, 0.5, 'triangle', 0.09, i * 0.09);
        });
        break;
      case 'stepstone':
      case 'cairn-built':
        this._note(196, 0.12, 'triangle', 0.08, 0);
        this._note(261.63, 0.16, 'sine', 0.06, 0.05);
        break;
      case 'cairn-removed':
        this._note(246.94, 0.1, 'sine', 0.06);
        break;
      case 'glide':
        this._note(392, 0.28, 'sine', 0.06, 0);
        this._note(523.25, 0.35, 'triangle', 0.05, 0.08);
        break;
      case 'wisp-collected':
        this._note(587.33, 0.45, 'sine', 0.09, 0);
        this._note(880.0, 0.85, 'sine', 0.09, 0.14);
        break;
      case 'heart-reached':
        [261.63, 329.63, 392.0, 523.25, 659.25, 783.99].forEach((f, i) => {
          this._note(f, 2.2, 'sine', 0.085, i * 0.16);
        });
        break;
      case 'item-switch':
        this._note(440, 0.07, 'triangle', 0.045);
        break;
      default:
        break;
    }
  }
}
