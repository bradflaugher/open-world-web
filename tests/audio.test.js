import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundEngine } from '../js/audio.js';
import { BIOME } from '../js/world.js';

function installMockAudio({ hidden = false } = {}) {
  const calls = { suspend: 0, resume: 0, notes: 0 };
  class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
          setTargetAtTime() {},
          cancelScheduledValues() {},
        },
        connect() {
          return this;
        },
      };
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: { value: 0, setValueAtTime() {}, setTargetAtTime() {} },
        connect() {
          return this;
        },
        start() {
          calls.notes += 1;
        },
        stop() {},
      };
    }
    suspend() {
      calls.suspend += 1;
      this.state = 'suspended';
      return Promise.resolve();
    }
    resume() {
      calls.resume += 1;
      this.state = 'running';
      return Promise.resolve();
    }
  }

  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  globalThis.window = { AudioContext: MockAudioContext };
  globalThis.document = { hidden };

  return {
    calls,
    setHidden(v) {
      globalThis.document.hidden = v;
    },
    restore() {
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
      if (prevDocument === undefined) delete globalThis.document;
      else globalThis.document = prevDocument;
    },
  };
}

test('SoundEngine suspends AudioContext in background and resumes when visible', () => {
  const env = installMockAudio({ hidden: false });
  try {
    const sound = new SoundEngine();
    sound.unlock();
    assert.equal(sound.ctx.state, 'running');
    const droneStarts = env.calls.notes;

    // Simulate switching away from the browser on mobile
    env.setHidden(true);
    sound.suspend();
    assert.equal(sound.ctx.state, 'suspended');
    assert.equal(env.calls.suspend, 1);

    // Stray unlock/update/event calls while hidden must not resume or schedule notes
    sound.unlock();
    sound.update(10, BIOME.MEADOW, 3);
    sound.handleEvent({ type: 'step' });
    assert.equal(sound.ctx.state, 'suspended');
    assert.equal(env.calls.resume, 0);
    assert.equal(env.calls.notes, droneStarts);

    // Returning to foreground resumes cleanly
    env.setHidden(false);
    sound.resume();
    assert.equal(sound.ctx.state, 'running');
    assert.equal(env.calls.resume, 1);
  } finally {
    env.restore();
  }
});

test('SoundEngine.setEnabled(false) suspends AudioContext and stays silent on resume', () => {
  const env = installMockAudio({ hidden: false });
  try {
    const sound = new SoundEngine();
    sound.unlock();
    sound.setEnabled(false);
    assert.equal(sound.ctx.state, 'suspended');

    sound.suspend();
    sound.resume();
    assert.equal(sound.ctx.state, 'suspended');
  } finally {
    env.restore();
  }
});
