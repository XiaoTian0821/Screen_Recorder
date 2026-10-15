/**
 * audio-mixer.js — Web Audio mixing for microphone + system audio.
 *
 * Builds a graph:
 *   mic source    -> micGain    -> analyser (meter)  ┐
 *   system source -> sysGain    ──────────────────────┤-> destination
 *   destination (MediaStreamAudioDestinationNode)      ┘
 *
 * The destination node's MediaStream is what gets attached to the
 * MediaRecorder alongside the video. This avoids duplicating tracks
 * and routes both sources into a single mixed audio output.
 */

export class AudioMixer {
  constructor() {
    this.ctx = null;
    this.micSource = null;
    this.sysSource = null;
    this.micGain = null;
    this.sysGain = null;
    this.analyser = null;
    this.destination = null;
    this.micLevelTimer = null;
    this.onLevel = null;
  }

  /**
   * Initialize the AudioContext and node graph.
   * @param {MediaStream} micStream - microphone-only stream (may be empty).
   * @param {MediaStream} sysStream - system audio stream (may be empty).
   */
  init(micStream, sysStream) {
    this.destroy();

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      throw new Error('Web Audio API is not available in this browser.');
    }
    this.ctx = new AC();

    this.micGain = this.ctx.createGain();
    this.sysGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.destination = this.ctx.createMediaStreamDestination();

    if (micStream && micStream.getAudioTracks().length) {
      this.micSource = this.ctx.createMediaStreamSource(micStream);
      this.micSource.connect(this.micGain);
      this.micGain.connect(this.analyser);
      this.analyser.connect(this.destination);
    }

    if (sysStream && sysStream.getAudioTracks().length) {
      this.sysSource = this.ctx.createMediaStreamSource(sysStream);
      this.sysSource.connect(this.sysGain);
      this.sysGain.connect(this.destination);
    }

    // Some browsers start the context suspended when created without a
    // user-gesture stack; resume immediately (we are always in a user gesture
    // path when init() is called).
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    this._startMeter();
  }

  setMicVolume(pct) {
    if (this.micGain) this.micGain.gain.value = clamp01pct(pct);
  }

  setSysVolume(pct) {
    if (this.sysGain) this.sysGain.gain.value = clamp01pct(pct);
  }

  /**
   * The mixed output stream to attach to the MediaRecorder.
   * Returns null when no audio sources exist, so the recorder can skip it.
   * @returns {MediaStream|null}
   */
  getOutput() {
    if (!this.destination) return null;
    const s = this.destination.stream;
    if (s.getAudioTracks().length === 0) return null;
    return s;
  }

  /**
   * Whether any audio source is actually present.
   * @returns {boolean}
   */
  hasAudio() {
    if (!this.ctx) return false;
    return !!(this.micSource || this.sysSource);
  }

  _startMeter() {
    const buf = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      this.analyser.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i];
      const avg = sum / buf.length / 255;
      if (this.onLevel) this.onLevel(avg);
      this.micLevelTimer = requestAnimationFrame(tick);
    };
    if (this.analyser) tick();
  }

  /** Tear down the graph and stop the meter. */
  destroy() {
    if (this.micLevelTimer) {
      cancelAnimationFrame(this.micLevelTimer);
      this.micLevelTimer = null;
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.micSource = null;
    this.sysSource = null;
    this.micGain = null;
    this.sysGain = null;
    this.analyser = null;
    this.destination = null;
    this.onLevel = null;
  }
}

/** Clamp a percentage (0–200) into a gain value (0–2). */
function clamp01pct(pct) {
  return Math.max(0, Math.min(2, pct / 100));
}
