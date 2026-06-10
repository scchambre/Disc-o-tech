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

  // Least-squares quadratic fit y ≈ a + b·x + c·x² (3x3 normal equations, Cramer's rule).
  // Used to model a steady spin that may gently slow down, so the leftover = real wobble.
  function polyfit2(xs, ys) {
    let S0 = xs.length, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], y = ys[i], x2 = x * x;
      S1 += x; S2 += x2; S3 += x2 * x; S4 += x2 * x2; T0 += y; T1 += x * y; T2 += x2 * y;
    }
    const det3 = m =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const A = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]], col = [T0, T1, T2];
    const D = det3(A);
    if (Math.abs(D) < 1e-12) return { a: 0, b: 0, c: 0 };
    const repl = j => A.map((row, i) => row.map((v, k) => (k === j ? col[i] : v)));
    return { a: det3(repl(0)) / D, b: det3(repl(1)) / D, c: det3(repl(2)) / D };
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

  // Circular mean of angles (radians) -> degrees in [0,360). Robust to wraparound.
  function circularMeanDeg(rads) {
    let s = 0, c = 0;
    for (const a of rads) { s += Math.sin(a); c += Math.cos(a); }
    return ((Math.atan2(s, c) * 180 / Math.PI) % 360 + 360) % 360;
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
    const warnings = [];
    const raw = throwObj.samples || [];
    if (raw.length < 8) return { ok: false, warnings: ['Too few samples (' + raw.length + ')'], series: emptySeries() };

    // Sort by timestamp so out-of-order or corrupted rows (flaky Bluetooth) can't
    // produce negative durations / sample rates.
    const sorted = raw.slice().sort((a, b) => a.t - b.t);
    // Drop duplicate-timestamp samples — e.g. if the same line was received twice
    // (USB serial + Bluetooth both connected), which otherwise scrambles the spin math.
    const samples = sorted.filter((s, i) => i === 0 || s.t !== sorted[i - 1].t);
    const n = samples.length;
    const tms = samples.map(s => s.t - samples[0].t);
    const durationMs = Math.max(1, tms[n - 1]);
    // Robust sample rate from the MEDIAN gap between samples (ignores a few bad timestamps).
    const dts = [];
    for (let i = 1; i < n; i++) { const d = tms[i] - tms[i - 1]; if (d > 0) dts.push(d); }
    const sampleRateHz = dts.length
      ? 1000 / dts.slice().sort((a, b) => a - b)[Math.floor(dts.length / 2)]
      : 1000 * (n - 1) / durationMs;
    const total = samples.map(s => (s.total != null ? s.total : Math.hypot(s.x, s.y, s.z)));

    // peak G = the single strongest spike (the metric)
    let peak = -Infinity, peakIdx = 0;
    for (let i = 0; i < n; i++) if (total[i] > peak) { peak = total[i]; peakIdx = i; }

    // FIXED g-scale: the micro:bit reads ~1024 milli-g per 1 g. Do NOT derive the scale
    // from the gravity reference — that's sampled whenever the disc is below ~1.3 g, which
    // includes mid-handling and near-free-fall, so its magnitude can be far from 1 g and
    // would wildly inflate peak-g (a near-free-fall gref of ~50 turned 13,000 into "266 g").
    const gScale = 1024;
    const grav = throwObj.gravityRef || gravityFromData(samples, total);
    let releaseTiltDeg = null, releaseTiltDirDeg = null;
    if (grav) {
      const gmag = Math.hypot(grav.x, grav.y, grav.z);
      if (gmag > 1) {
        // tilt = the reference vector's angle from vertical — a ratio, so only its
        // direction matters (its magnitude cancels out)
        releaseTiltDeg = Math.acos(Math.min(1, Math.abs(grav.z) / gmag)) * 180 / Math.PI;
        releaseTiltDirDeg = Math.atan2(grav.y, grav.x) * 180 / Math.PI;
      }
    } else {
      warnings.push('No still window found — release angle unavailable.');
    }
    const peakG = peak / gScale;

    // RELEASE = the FIRST big spike (the throw), NOT the global max. A net impact is
    // often a BIGGER spike than the throw and comes LATER, so picking the max would make
    // us measure the post-impact tumble. FLIGHT = the calm window from just after the
    // release spike up to the NEXT spike (e.g. hitting the net) — the clean mid-air spin.
    const SPIKE = 2.5 * gScale;
    let releaseIdx = peakIdx;
    for (let i = 0; i < n; i++) if (total[i] > SPIKE) { releaseIdx = i; break; }
    // After the release spike, take the LONGEST calm (flight-like) run — this excludes the
    // release spike, the net impact, AND any post-impact tumble, leaving the clean mid-air
    // flight even when there are several bumps.
    let after = releaseIdx;
    while (after < n && total[after] > SPIKE) after++;        // first sample past the release spike
    let fStart = after, fEnd = after, bestLen = 0, curStart = after, curLen = 0;
    for (let i = after; i < n; i++) {
      if (total[i] <= SPIKE) {
        if (curLen === 0) curStart = i;
        curLen++;
        if (curLen > bestLen) { bestLen = curLen; fStart = curStart; fEnd = i + 1; }
      } else curLen = 0;
    }

    // Spin metrics from the magnetometer phase, over that clean flight window. Tolerate
    // dropped samples (link loss) by using only samples with valid mx,my,x,y.
    let rpm = null, spinWobbleDeg = null, flightTiltDeg = null, flightLeanBearingDeg = null;
    const segAll = samples.slice(fStart, fEnd);
    const seg = segAll.filter(s => s.mx != null && s.my != null && !isNaN(s.mx) && !isNaN(s.my) &&
      s.x != null && s.y != null && !isNaN(s.x) && !isNaN(s.y));
    const droppedMag = segAll.length - seg.length;
    if (seg.length < 8) {
      warnings.push('Too few clean flight samples to read spin (' + seg.length + ' usable' +
        (droppedMag ? ', ' + droppedMag + ' missing — link dropping data' : '') + ').');
    } else {
      if (droppedMag > segAll.length * 0.15) {
        warnings.push(droppedMag + ' samples lost data (link drops) — readings approximate.');
      }
      const t0 = seg[0].t;
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
      if (amp < 4 || r2 < 0.75) {
        // Not a real rotation — don't invent numbers from noise. (0.75 lets real-but-
        // wobbly throws register; the wobble° value flags how clean each one was.)
        warnings.push('No steady rotation detected (signal ' + amp.toFixed(1) + ' µT, fit ' +
          (r2 * 100).toFixed(0) + '%). RPM/wobble need a clean spin about the disc axis — ' +
          'sliding or shaking just reads sensor noise.');
      } else {
        rpm = Math.abs(fit.slope) * 60 / (2 * Math.PI);

        // SPIN WOBBLE (degrees), noise-floor removed. Fit a quadratic (steady rate +
        // gentle spin-down); the leftover residual is wobble + noise. Estimate the
        // white-noise variance from high-frequency jitter (consecutive differences) and
        // subtract it, so what's left is REAL wobble, not sensor noise.
        const q = polyfit2(secs, phase);
        const resid = phase.map((p, i) => p - (q.a + q.b * secs[i] + q.c * secs[i] * secs[i]));
        const diffs = [];
        for (let i = 1; i < resid.length; i++) diffs.push(resid[i] - resid[i - 1]);
        const noiseVar = diffs.length ? variance(diffs) / 2 : 0;
        spinWobbleDeg = Math.sqrt(Math.max(0, variance(resid) - noiseVar)) * 180 / Math.PI;

        // FLIGHT TILT (degrees): in the air, gravity appears as a spin-frequency wobble
        // in the in-plane accel with amplitude g*sin(tilt). Centering removes the
        // centripetal DC; the leftover oscillation radius ≈ g*sin(tilt) = actual attitude.
        const axC = center(seg.map(s => s.x));
        const ayC = center(seg.map(s => s.y));
        const inPlaneAmp = Math.sqrt(mean(axC.map((v, i) => v * v + ayC[i] * ayC[i])));
        flightTiltDeg = Math.asin(Math.min(1, inPlaneAmp / gScale)) * 180 / Math.PI;
        if (seg.some(s => Math.abs(s.x) > 7.6 * gScale || Math.abs(s.y) > 7.6 * gScale)) {
          warnings.push('In-flight accel clipped (±8 g) — flight angle under-reads; mount nearer the disc center.');
        }

        // LEAN BEARING (cardinal): which compass direction the disc tips toward. The
        // gravity wobble (accel) and the field (mag) both rotate with the disc; the
        // constant phase offset between them is the lean's bearing from magnetic north.
        // Only meaningful when there's a real lean — a flat disc has no lean direction.
        if (flightTiltDeg > 5) {
          const delta = [];
          for (let i = 0; i < seg.length; i++) {
            delta.push(Math.atan2(ayC[i], axC[i]) - Math.atan2(myC[i], mxC[i]));
          }
          flightLeanBearingDeg = circularMeanDeg(delta);
        }

        if (sampleRateHz < 2.2 * (rpm / 60)) {
          warnings.push('Sample rate ' + sampleRateHz.toFixed(0) + ' Hz too low for ' +
            rpm.toFixed(0) + ' RPM — aliasing likely. Use an IMU with a gyro for drives.');
        }
      }
    }

    return {
      ok: true, n, durationMs, sampleRateHz, peakG,
      releaseTiltDeg, releaseTiltDirDeg, flightTiltDeg, flightLeanBearingDeg, rpm, spinWobbleDeg,
      releaseIdx, releaseTimeMs: tms[releaseIdx], gScale, warnings,
      series: { tms, total, mx: samples.map(s => s.mx), my: samples.map(s => s.my), releaseIdx }
    };
  }

  function emptySeries() { return { tms: [], total: [], mx: [], my: [], releaseIdx: 0 }; }

  const api = { parseThrows, analyzeThrow, _helpers: { mean, std, linreg, unwrap } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.DiscMetrics = api;
})(typeof window !== 'undefined' ? window : globalThis);
