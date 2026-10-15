/**
 * recorder.js — MediaRecorder lifecycle management.
 *
 * States: idle -> recording -> paused -> processing -> (review)
 *
 * Responsibilities:
 * - pick the best supported MIME type / codec
 * - start / pause / resume / stop with proper event handling
 * - elapsed-time tracking that excludes paused time
 * - produce the final Blob and revoke any object URLs
 */

// Codec preference order for good compatibility + quality.
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4', // Safari 15+ supports this
  'video/ogg;codecs=theora',
];

export function detectMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* keep trying */ }
  }
  return null;
}

export function mimeToExt(mime) {
  if (!mime) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export function mimeLabel(mime) {
  if (!mime) return 'Unsupported';
  if (mime.includes('vp9')) return 'WebM (VP9 + Opus)';
  if (mime.includes('vp8')) return 'WebM (VP8 + Opus)';
  if (mime.includes('mp4')) return 'MP4 (H.264/AAC)';
  if (mime.includes('theora')) return 'OGG (Theora)';
  if (mime.includes('webm')) return 'WebM';
  return mime;
}

export class Recorder {
  constructor() {
    this.rec = null;
    this.state = 'idle'; // idle|recording|paused|processing
    this.chunks = [];
    this.startTime = 0;
    this.accumulated = 0; // ms of non-paused time
    this.timerId = null;
    this.mimeType = null;
  }

  get isRecording() { return this.state === 'recording'; }
  get isPaused() { return this.state === 'paused'; }
  get isIdle() { return this.state === 'idle'; }

  /**
   * Start recording.
   * @param {MediaStream} stream
   * @param {object} opts - {videoBitrate, mimeType, onTick, onStopped}
   * @returns {Promise<void>}
   */
  async start(stream, opts = {}) {
    if (!this.isIdle) {
      throw new Error('Recorder is not idle; stop the current session first.');
    }
    const mime = opts.mimeType || detectMimeType();
    if (!mime || !stream) {
      this.state = 'error';
      throw new Error('No supported output format or media stream available.');
    }
    this.mimeType = mime;
    this.chunks = [];
    this.accumulated = 0;

    const recOptions = {
      audioBitsPerSecond: 128000,
      videoBitsPerSecond: opts.videoBitrate || 4000000,
      mimeType: mime,
    };

    let recorder;
    try {
      recorder = new MediaRecorder(stream, recOptions);
    } catch (e) {
      // Retry with a minimal config (some browsers reject specific options).
      try {
        recorder = new MediaRecorder(stream);
      } catch (e2) {
        this.state = 'error';
        throw e2;
      }
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.onstop = () => {
      this.state = 'idle';
      if (opts.onStopped) opts.onStopped(this.buildBlob());
    };
    recorder.onerror = (e) => {
      this.state = 'error';
      if (opts.onError) opts.onError(e.error || new Error('MediaRecorder error'));
    };

    this.rec = recorder;
    recorder.start(250); // collect data every 250 ms for lower memory bursts
    this.state = 'recording';
    this._startTimer(opts.onTick);
  }

  _startTimer(onTick) {
    this.startTime = performance.now();
    const tick = () => {
      if (this.state !== 'recording') {
        this.timerId = null;
        return;
      }
      if (onTick) onTick(this.getElapsed());
      this.timerId = requestAnimationFrame(tick);
    };
    tick();
  }

  /**
   * Pause the recording (timeline freezes).
   */
  pause() {
    if (this.state !== 'recording') return;
    try { this.rec.pause(); } catch (e) { /* pause unsupported — degrade gracefully */ }
    this.accumulated += performance.now() - this.startTime;
    this.state = 'paused';
  }

  /**
   * Resume after a pause.
   */
  resume() {
    if (this.state !== 'paused') return;
    try { this.rec.resume(); } catch (e) { /* ignore */ }
    this.state = 'recording';
    this.startTime = performance.now();
  }

  /**
   * Stop and finalize. Returns a Promise that resolves to the Blob.
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.rec) { resolve(null); return; }
      if (this.state === 'paused') {
        try { this.rec.resume(); } catch (e) { /* ignore */ }
      }
      this.state = 'processing';
      const origOnStop = this.rec.onstop;
      this.rec.onstop = () => {
        this._stopTimer();
        const blob = this.buildBlob();
        if (origOnStop) origOnStop();
        resolve(blob);
      };
      try { this.rec.stop(); } catch (e) {
        // Already stopped — resolve immediately.
        this._stopTimer();
        resolve(this.buildBlob());
      }
    });
  }

  _stopTimer() {
    if (this.timerId) cancelAnimationFrame(this.timerId);
    this.timerId = null;
    this.rec = null;
    this.state = 'idle';
  }

  buildBlob() {
    if (!this.chunks.length) return null;
    const mime = this.mimeType || 'video/webm';
    return new Blob(this.chunks, { type: mime });
  }

  /**
   * Elapsed time excluding paused intervals.
   * @returns {number} milliseconds
   */
  getElapsed() {
    if (this.state === 'paused') return this.accumulated;
    // recording / processing: add the time since last start/resume.
    let total = this.accumulated;
    total += performance.now() - this.startTime;
    return total;
  }

  /**
   * Clean up all resources.
   */
  destroy() {
    this._stopTimer();
    this.chunks = [];
    this.state = 'idle';
  }
}

/**
 * Format milliseconds as HH:MM:SS.
 * @param {number} ms
 */
export function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Format bytes into a human-readable string.
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  if (bytes === 0 || bytes == null) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
