/* Disc-o-tech — tiny canvas line plotter (no dependencies).
 * window.DiscPlot.draw(canvas, series, opts)
 *   series = [{ xs?, ys, color, label }]   xs defaults to sample index
 */
(function (global) {
  'use strict';

  function draw(canvas, series, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const pad = { l: 44, r: 10, t: 18, b: 22 };
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0e1116'; ctx.fillRect(0, 0, W, H);

    const valid = series.filter(s => s.ys && s.ys.length);
    if (!valid.length) { label(ctx, 'no data', W / 2 - 20, H / 2, '#667'); return; }

    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (const s of valid) {
      const xs = s.xs || s.ys.map((_, i) => i);
      s._xs = xs;
      for (let i = 0; i < s.ys.length; i++) {
        const x = xs[i], y = s.ys[i];
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y == null || isNaN(y)) continue;
        if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      }
    }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    if (xMin === xMax) xMax = xMin + 1;
    const padY = (yMax - yMin) * 0.08; yMin -= padY; yMax += padY;

    const px = x => pad.l + (x - xMin) / (xMax - xMin) * (W - pad.l - pad.r);
    const py = y => H - pad.b - (y - yMin) / (yMax - yMin) * (H - pad.t - pad.b);

    // axes + zero line
    ctx.strokeStyle = '#222a33'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, H - pad.b); ctx.lineTo(W - pad.r, H - pad.b); ctx.stroke();
    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = '#2c3744'; ctx.beginPath(); ctx.moveTo(pad.l, py(0)); ctx.lineTo(W - pad.r, py(0)); ctx.stroke();
    }
    ctx.fillStyle = '#8a97a5'; ctx.font = '10px system-ui,sans-serif';
    ctx.fillText(yMax.toFixed(0), 4, py(yMax) + 8);
    ctx.fillText(yMin.toFixed(0), 4, py(yMin));
    if (opts.xlabel) ctx.fillText(opts.xlabel, W - pad.r - 60, H - 6);

    // release marker
    if (opts.releaseX != null) {
      ctx.strokeStyle = '#e0b341'; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(px(opts.releaseX), pad.t); ctx.lineTo(px(opts.releaseX), H - pad.b); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#e0b341'; ctx.fillText('release', px(opts.releaseX) + 3, pad.t + 9);
    }

    // series
    for (const s of valid) {
      ctx.strokeStyle = s.color || '#4fa3ff'; ctx.lineWidth = 1.5; ctx.beginPath();
      let started = false;
      for (let i = 0; i < s.ys.length; i++) {
        const y = s.ys[i]; if (y == null || isNaN(y)) { started = false; continue; }
        const X = px(s._xs[i]), Y = py(y);
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      ctx.stroke();
    }

    // legend
    let lx = pad.l + 6;
    for (const s of valid) {
      if (!s.label) continue;
      ctx.fillStyle = s.color || '#4fa3ff'; ctx.fillRect(lx, pad.t - 12, 9, 9);
      ctx.fillStyle = '#cdd6e0'; ctx.fillText(s.label, lx + 13, pad.t - 4);
      lx += 20 + ctx.measureText(s.label).width;
    }
    if (opts.title) { ctx.fillStyle = '#cdd6e0'; ctx.fillText(opts.title, W - pad.r - ctx.measureText(opts.title).width, pad.t - 4); }
  }

  function label(ctx, t, x, y, c) { ctx.fillStyle = c; ctx.font = '12px system-ui'; ctx.fillText(t, x, y); }

  global.DiscPlot = { draw };
})(window);
