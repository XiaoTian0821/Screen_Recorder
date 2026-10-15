/**
 * canvas-compositor.js — Optional studio composition.
 *
 * When enabled, the screen video track and (optionally) a webcam video
 * track are drawn onto a canvas at the configured output resolution and
 * frame rate. The resulting canvas.captureStream() is used as the video
 * input to the MediaRecorder instead of the raw screen track.
 *
 * Aspect ratio of the screen is preserved (letterboxed). The webcam is
 * drawn in a corner at a fixed relative size, with the mirror setting
 * applied when requested.
 */

const WEBcam_REL_SIZE = 0.24;  // webcam width as fraction of canvas width

export class CanvasCompositor {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx2d = canvasEl.getContext('2d', { alpha: false });
    this.rafId = null;
    this.running = false;
    this.mirror = false;
  }

  /**
   * Start compositing.
   * @param {MediaStream|HTMLVideoElement} screen - source screen video.
   * @param {HTMLVideoElement|null} webcam - optional webcam preview element.
   * @param {number} width - target canvas width in px.
   * @param {number} height - target canvas height in px.
   * @param {number} fps - target frame rate.
   * @returns {MediaStream} captured stream (video + audio if webcam silent).
   */
  start(screen, webcam, width, height, fps) {
    this.stop();

    const w = Math.max(320, Math.round(width));
    const h = Math.max(180, Math.round(height));
    this.canvas.width = w;
    this.canvas.height = h;
    this.mirror = false;

    const stream = this.canvas.captureStream(fps);

    const tick = () => {
      this._draw(screen, webcam, w, h);
      this.rafId = requestAnimationFrame(tick);
    };
    this.running = true;
    tick();

    return stream;
  }

  _draw(screen, webcam, w, h) {
    const ctx = this.ctx2d;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const srcW = screen.videoWidth || screen.width || w;
    const srcH = screen.videoHeight || screen.height || h;
    if (srcW > 0 && srcH > 0) {
      // Fit screen into canvas, preserving aspect ratio, centered.
      const scale = Math.min(w / srcW, h / srcH);
      const dw = srcW * scale;
      const dh = srcH * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.drawImage(screen, dx, dy, dw, dh);
    }

    if (webcam && webcam.videoWidth > 0) {
      const ww = w * WEBcam_REL_SIZE;
      const wh = ww * (webcam.videoHeight / webcam.videoWidth || 9 / 16);
      const wx = w - ww - 12;
      const wy = h - wh - 12;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(wx, wy, ww, wh, 10) : ctx.rect(wx, wy, ww, wh);
      ctx.clip();
      ctx.translate(wx, wy);
      if (this.mirror) {
        ctx.translate(ww, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(webcam, 0, 0, ww, wh);
      ctx.restore();

      // Subtle border
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(wx, wy, ww, wh, 10) : ctx.rect(wx, wy, ww, wh);
      ctx.stroke();
      ctx.restore();
    }
  }

  setMirror(on) { this.mirror = !!on; }

  /** Stop the loop without releasing the canvas. */
  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.running = false;
  }
}
