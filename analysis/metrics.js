/* Disc-o-tech — flight metrics engine
 * Pure functions, no dependencies. Works in the browser (window.DiscMetrics)
 * and in Node (require('./metrics.js')).
 *
 * Input data is a CSV (from the base-station serial stream OR a datalogger
 * MY_DATA.HTM export). Columns are matched by NAME, so both sources work:
 *   time, x, y, z, total, mx, my   (aliases handled in classify())
 *
 * Units: micro:bit accelerometer ~1000 per g; magnetometer in microtesla.
 * The g-scale is auto-detected from the still ("gravity") part of the throw,
 * so exact units don't matter for the angle math (ratios cancel).
 */
(function (global) {
  'use strict';

  // ---------- small stats helpers ----------
  const sum = a => a.reduce((s, v) => s + v, 0);
  const mean = a => (a.length ? sum(a) / a.length : 0);
  function variance(a) { const m = mean(a); return a.length ? mean(a.map(v => (v - m) * (v - m))) : 0; }
  const std = a => Math.sqrt(variance(a));
  const center = a => { const m = mean(a); return a.map(v => v - m); };

  // Linear regression y = slope*x + intercept (least squares)
  function linreg(xs, ys) {
    const n = xs.length, mx = mean(xs), my = mean(ys);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    return { slope, intercept: my - slope * mx };
  }

  // R²: how well the points follow the fitted line. ~1 = phase climbs linearly
  // (a real, steady rotation); low = the "rotation" is just noise/wandering.
  function rSquared(xs, ys, fit) {
    const m = mean(ys); let ssRes = 0, ssTot = 0;
    for (let i = 0; i < xs.length; i++) {
      const pred = fit.slope * xs[i] + fit.intercept;
      ssRes += (ys[i] - pred) ** 2; ssTot += (ys[i] - m) ** 2;
    }
    return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  }

  // Phase unwrap: remove 2*pi jumps so we can fit a straight line through it.
  function unwrap(p) {
    const out = p.slice();
    for (let i = 1; i < out.length; i++) {
      let d = out[i] - out[i - 1];
      while (d > Math.PI) { out[i] -= 2 * Math.PI; d = out[i] - out[i - 1]; }
      while (d < -Math.PI) { out[i] += 2 * Math.PI; d = out[i] - out[i - 1]; }
    }
    return out;
  }

  // ---------- CSV parsing ----------
  function classify(h) {
    const s = String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s.startsWith('time') || s === 't' || s === 'millis' || s === 'timestamp') return 'time';
    if (s === 'x' || s === 'ax' || s === 'accx' || s === 'accelx' || s === 'accelerationx') return 'x';
    if (s === 'y' || s === 'ay' || s === 'accy' || s === 'accely' || s === 'accelerationy') return 'y';
    if (s === 'z' || s === 'az' || s === 'accz' || s === 'accelz' || s === 'accelerationz') return 'z';
    if (s === 'total' || s === 'strength' || s === 'accstrength' || s === 'magnitude' || s === 'accelerationstrength') return 'total';
    if (s === 'mx' || s === 'magx' || s === 'bx' || s === 'magneticforcex' || s === 'compassx') return 'mx';
    if (s === 'my' || s === 'magy' || s === 'by' || s === 'magneticforcey' || s === 'compassy') return 'my';
    return null;
  }

  // Returns an array of throws: [{ gravityRef:{x,y,z}|null, samples:[{t,x,y,z,mx,my,total}] }]
  // Splits on lines starting with '#' (live-stream throw markers). A plain
  // datalogger CSV (no markers) returns a single throw.
  function parseThrows(text) {
    const lines = String(text).split(/\r?\n/);
    let map = null;
    const throwsArr = [];
    let cur = null;
    const ensureCur = () => { if (!cur) { cur = { gravityRef: null, samples: [] }; throwsArr.push(cur); } };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line[0] === '#') {                       // throw boundary marker
        cur = { gravityRef: null, samples: [] };
        throwsArr.push(cur);
        const m = line.match(/gref\s*=\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
        if (m) cur.gravityRef = { x: +m[1], y: +m[2], z: +m[3] };
        continue;
      }
      const cells = line.split(',');
      if (!map) {
        const looksHeader = cells.some(c => isNaN(parseFloat(c)));
        if (looksHeader) { map = cells.map(classify); continue; }
        map = ['time', 'x', 'y', 'z', 'total', 'mx', 'my'].slice(0, cells.length); // headerless fallback
      }
      ensureCur();
      const s = {};
      for (let i = 0; i < cells.length; i++) {
        const f = map[i]; if (!f) continue;
        const v = parseFloat(cells[i]); if (!isNaN(v)) s[f] = v;
      }
      if (s.x == null && s.time == null) continue;          // junk line
      if (s.total == null && s.x != null) s.total = Math.hypot(s.x, s.y, s.z);
      if (s.time == null) s.time = cur.samples.length;
      cur.samples.push({ t: s.time, x: s.x, y: s.y, z: s.z, mx: s.mx, my: s.my, total: s.total });
    }
    return throwsArr.filter(tr => tr.samples.length > 0);
  }

  // ---------- gravity reference (release-angle baseline) ----------
  // Find the quietest run of accel samples (disc nearly still) and average it.
  // Used only when the firmware didn't already supply a gravityRef.
  function gravityFromData(samples, total) {
    const n = total.length, W = Math.min(7, n);
    if (n < W) return null;
    let bestVar = Infinity, bestI = 0;
    for (let i = 0; i + W <= n; i++) {
      const v = variance(total.slice(i, i + W));
      if (v < bestVar) { bestVar = v; bestI = i; }
    }
    const seg = samples.slice(bestI, bestI + W);
    return { x: mean(seg.map(s => s.x)), y: mean(seg.map(s => s.y)), z: mean(seg.map(s => s.z)) };
  }

  // ---------- main analysis ----------
  function analyzeThrow(input) {
    const throwObj = Array.isArray(input) ? { samples: input, gravityRef: null } : input;
    const samples = throwObj.samples;
    const warnings = [];
    const n = samples.length;
    if (n < 8) return { ok: false, warnings: ['Too few samples (' + n + ')'], series: emptySeries() };

    const tms = samples.map(s => s.t - samples[0].t);
    const durationMs = tms[n - 1] || 1;
    const sampleRateHz = 1000 * (n - 1) / durationMs;
    const total = samples.map(s => (s.total != null ? s.total : Math.hypot(s.x, s.y, s.z)));

    // release = biggest acceleration spike
    let releaseIdx = 0, peak = -Infinity;
    for (let i = 0; i < n; i++) if (total[i] > peak) { peak = total[i]; releaseIdx = i; }

    // gravity reference -> g-scale + release tilt
    const grav = throwObj.gravityRef || gravityFromData(samples, total);
    let gScale = 1000, releaseTiltDeg = null, releaseTiltDirDeg = null;
    if (grav) {
      const gmag = Math.hypot(grav.x, grav.y, grav.z);
      if (gmag > 1) {
        gScale = gmag;
        releaseTiltDeg = Math.acos(Math.min(1, Math.abs(grav.z) / gmag)) * 180 / Math.PI;
        releaseTiltDirDeg = Math.atan2(grav.y, grav.x) * 180 / Math.PI;
      }
    } else {
      warnings.push('No still window found — release angle unavailable.');
    }
    const peakG = peak / gScale;

    // RPM from magnetometer phase, over the post-release (flight) region.
    // Tolerate occasional dropped samples (e.g. Bluetooth packet loss) by using
    // only the samples that actually have valid mx,my instead of all-or-nothing.
    let rpm = null, spinStabilityPct = null;
    const segAll = samples.slice(releaseIdx);
    const seg = segAll.filter(s => s.mx != null && s.my != null && !isNaN(s.mx) && !isNaN(s.my));
    const droppedMag = segAll.length - seg.length;
    if (seg.length < 8) {
      warnings.push('Too few magnetometer samples for RPM (' + seg.length + ' usable' +
        (droppedMag ? ', ' + droppedMag + ' missing — link dropping data' : '') + ').');
    } else {
      if (droppedMag > segAll.length * 0.15) {
        warnings.push(droppedMag + ' samples lost mag data (link drops) — RPM is approximate.');
      }
      const t0 = samples[releaseIdx].t;
      const secs = seg.map(s => (s.t - t0) / 1000);
      const mxC = center(seg.map(s => s.mx));
      const myC = center(seg.map(s => s.my));
      // Amplitude = radius of the circle the field traces in the disc plane. A real
      // spin traces a wide circle (~Earth's horizontal field, tens of µT); sliding or
      // shaking leaves a tiny noisy blob near the origin.
      const amp = Math.sqrt(mean(mxC.map((v, i) => v * v + myC[i] * myC[i])));
      const phase = unwrap(mxC.map((_, i) => Math.atan2(myC[i], mxC[i])));
      const fit = linreg(secs, phase);
      const r2 = rSquared(secs, phase, fit);
      if (amp < 4 || r2 < 0.9) {
        // Not a real rotation — don't invent an RPM from noise.
        warnings.push('No steady rotation detected (signal ' + amp.toFixed(1) + ' µT, fit ' +
          (r2 * 100).toFixed(0) + '%). RPM needs a clean spin about the disc axis — ' +
          'sliding or shaking just reads sensor noise.');
      } else {
        rpm = Math.abs(fit.slope) * 60 / (2 * Math.PI);
        const inst = [];
        for (let i = 1; i < phase.length; i++) {
          const dt = secs[i] - secs[i - 1];
          if (dt > 0) inst.push(Math.abs((phase[i] - phase[i - 1]) / dt));
        }
        const m = mean(inst);
        spinStabilityPct = m > 0 ? (std(inst) / m) * 100 : null;
        if (sampleRateHz < 2.2 * (rpm / 60)) {
          warnings.push('Sample rate ' + sampleRateHz.toFixed(0) + ' Hz too low for ' +
            rpm.toFixed(0) + ' RPM — aliasing likely. Use an IMU with a gyro for drives.');
        }
      }
    }

    return {
      ok: true, n, durationMs, sampleRateHz, peakG,
      releaseTiltDeg, releaseTiltDirDeg, rpm, spinStabilityPct,
      releaseIdx, releaseTimeMs: tms[releaseIdx], gScale, warnings,
      series: { tms, total, mx: samples.map(s => s.mx), my: samples.map(s => s.my), releaseIdx }
    };
  }

  function emptySeries() { return { tms: [], total: [], mx: [], my: [], releaseIdx: 0 }; }

  const api = { parseThrows, analyzeThrow, _helpers: { mean, std, linreg, unwrap } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DiscMetrics = api;
})(typeof window !== 'undefined' ? window : globalThis);
