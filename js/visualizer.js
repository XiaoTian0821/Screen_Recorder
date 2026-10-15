/**
 * visualizer.js — Microphone level meter rendering.
 *
 * Wraps a callback-driven meter that reads normalized levels from the
 * AudioMixer and updates a DOM element width in real time. Also
 * provides a 2-D bar spectrum rendering for a canvas-based option.
 */

/**
 * Attach a DOM bar meter.
 * @param {HTMLDivElement} fillEl - element whose width should reflect level.
 * @param {Function} onLevel - receives (level: 0..1) from the mixer.
 * @returns {Function} unsubscribe
 */
export function bindMeter(fillEl, onLevel) {
  const update = (level) => {
    const pct = Math.min(100, Math.round(level * 100));
    fillEl.style.width = pct + '%';
  };
  return (level) => update(level);
}

/**
 * Draw a simple frequency bar visualizer into a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {AnalyserNode} analyser
 * @returns {Function} stop
 */
export function drawBars(canvas, analyser) {
  const ctx = canvas.getContext('2d');
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf;
  const BARS = 24;

  const draw = () => {
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barW = canvas.width / BARS;
    const step = Math.floor(data.length / BARS);
    for (let i = 0; i < BARS; i++) {
      const v = data[i * step] / 255;
      const h = v * canvas.height;
      ctx.fillStyle = `rgba(109,124,255,${0.35 + v * 0.6})`;
      ctx.fillRect(i * barW + 1, canvas.height - h, barW - 2, h);
    }
    raf = requestAnimationFrame(draw);
  };
  draw();
  return () => cancelAnimationFrame(raf);
}
