#!/usr/bin/env node
/* Disc-o-tech — test suite.   Run:  node test.js
 *
 * There is no way to unit-test a thrown disc, so instead we SYNTHESISE throws with
 * known physics (a chosen RPM, tilt, lean and wobble) and assert the analyzer recovers
 * them. Every bug found in the field also gets a regression test here, so it can't
 * come back silently.
 */
'use strict';
const { parseThrows, analyzeThrow } = require('./metrics.js');

// ---------- tiny test harness ----------
let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return true; }
  fail++; failures.push(name + (detail ? '  → ' + detail : ''));
  return false;
}
const near = (name, got, want, tol) =>
  check(name, got != null && Math.abs(got - want) <= tol,
    'got ' + (got == null ? 'null' : (+got).toFixed(2)) + ', want ' + want + ' ±' + tol);

// ---------- synthetic throw generator ----------
const G = 1024;                       // milli-g per g, as the micro:bit reports
const R = a => (Math.random() - 0.5) * 2 * a;

/* Builds a physically-shaped capture: still reach-back → release spike → spinning flight.
 *  rpm       spin rate in flight
 *  reachTilt degrees the disc is held off level before the throw
 *  flightTilt degrees the spin axis is tilted in the air (drives the gravity wobble)
 *  leanBearing direction of that lean relative to the field (for the bearing test)
 *  wobbleRad extra sinusoidal jitter on the spin phase
 *  hz        sample rate
 *  impactAfter if set, append a net-impact spike + tumble at the end
 *  noMag     omit magnetometer columns
 *  gref      override the gravity reference written into the header
 */
function makeThrow(o) {
  o = Object.assign({
    rpm: 480, reachTilt: 12, reachDir: 30, flightTilt: 20, leanBearing: null,
    wobbleRad: 0, hz: 100, still: 14, flight: 60, spike: 4,
    impactAfter: false, noMag: false, gref: undefined, spin: true, magAmp: 250
  }, o);
  const dt = 1000 / o.hz;
  const spinHz = o.rpm / 60;
  const rows = [];
  let t = 0;
  const push = (x, y, z, mx, my) => {
    const r = [Math.round(t), Math.round(x), Math.round(y), Math.round(z)];
    rows.push(o.noMag ? r.join(',') : r.concat([Math.round(mx), Math.round(my)]).join(','));
    t += dt;
  };

  // reach-back: held still at reachTilt
  const rt = o.reachTilt * Math.PI / 180, rd = o.reachDir * Math.PI / 180;
  const gz = Math.cos(rt) * G, gh = Math.sin(rt) * G;
  const gx = gh * Math.cos(rd), gy = gh * Math.sin(rd);
  for (let i = 0; i < o.still; i++) push(gx + R(8), gy + R(8), gz + R(8), 300 + R(3), 100 + R(3));

  // release: a hard spike that clips
  for (let i = 0; i < o.spike; i++) push(R(3000), R(3000), 8000, 300 + R(40), 100 + R(40));

  // flight: gravity appears as a spin-frequency wobble of amplitude g*sin(flightTilt)
  const A = G * Math.sin(o.flightTilt * Math.PI / 180);
  const beta = (o.leanBearing == null ? 0 : o.leanBearing) * Math.PI / 180;
  for (let i = 0; i < o.flight; i++) {
    const psi = 2 * Math.PI * spinHz * (t / 1000) + o.wobbleRad * Math.sin(2 * Math.PI * 3 * (t / 1000));
    if (!o.spin) { push(200 + R(15), 200 + R(15), 940 + R(20), 300 + R(2), 100 + R(2)); continue; }
    push(200 + A * Math.cos(psi - beta) + R(10), 200 - A * Math.sin(psi - beta) + R(10), 940 + R(20),
      300 + o.magAmp * Math.cos(psi) + R(8), 100 - o.magAmp * Math.sin(psi) + R(8));
  }

  // optional net impact + post-impact tumble (bigger than the release!)
  if (o.impactAfter) {
    for (let i = 0; i < 3; i++) push(8160, 8160, 8160, 300 + R(200), 100 + R(200));
    for (let i = 0; i < 25; i++) push(R(2000), R(2000), R(2000), 300 + R(150), 100 + R(150));
  }

  const g = o.gref !== undefined ? o.gref
    : [Math.round(gx), Math.round(gy), Math.round(gz)];
  const hdr = g === null ? '# throw 1' : '# throw 1 gref=' + g.join(',');
  const cols = o.noMag ? 't,x,y,z' : 't,x,y,z,mx,my';
  return hdr + '\n' + cols + '\n' + rows.join('\n') + '\n# end\n';
}
const analyze = o => analyzeThrow(parseThrows(makeThrow(o))[0]);

// ================= PARSING =================
console.log('\n— parsing —');
{
  const csv = 'time (milliseconds),x,y,z,total,mx,my\n0,1,2,1024,1024,10,5\n10,1,2,1024,1024,11,6\n';
  const t = parseThrows(csv)[0];
  check('header aliases map to fields', t && t.samples[0].t === 0 && t.samples[0].z === 1024 && t.samples[0].mx === 10);
}
{
  const t = parseThrows('0,1,2,1024,1024,10,5\n10,1,2,1024,1024,11,6\n')[0];
  check('headerless CSV still parses', t && t.samples.length === 2);
}
{
  const two = makeThrow({}) + makeThrow({ rpm: 300 });
  check('multiple throws split on # markers', parseThrows(two).length === 2,
    'got ' + parseThrows(two).length);
}
{
  const t = parseThrows('# throw 7 gref=10,-20,1000\nt,x,y,z,mx,my\n0,1,2,3,4,5\n')[0];
  check('gref parsed from marker', t.gravityRef && t.gravityRef.z === 1000);
}
{
  const t = parseThrows('# throw 1\nt,x,y,z,mx,my\n\n   \n0,1,2,3,4,5\n')[0];
  check('blank/junk lines ignored', t && t.samples.length === 1);
}

// ================= KNOWN-VALUE RECOVERY =================
console.log('\n— physics recovery —');
{
  const m = analyze({ rpm: 480, reachTilt: 12, flightTilt: 20 });
  near('RPM recovered', m.rpm, 480, 25);
  near('reach-back tilt recovered', m.releaseTiltDeg, 12, 2);
  near('flight tilt recovered', m.flightTiltDeg, 20, 3);
  check('clean spin ⇒ low wobble', m.spinWobbleDeg != null && m.spinWobbleDeg < 5,
    'wobble ' + (m.spinWobbleDeg || 0).toFixed(1));
  check('clean throw ⇒ no warnings', m.warnings.length === 0, m.warnings.join(' | '));
}
{
  near('slow spin recovered', analyze({ rpm: 120 }).rpm, 120, 15);
  near('fast spin recovered', analyze({ rpm: 900, hz: 200 }).rpm, 900, 60);
}
{
  const m = analyze({ wobbleRad: 0.1 });   // ~0.1 rad ⇒ ~4° RMS
  near('injected wobble measured', m.spinWobbleDeg, 4, 3);
}
[45, 135, 270].forEach(b => {
  const m = analyze({ leanBearing: b, flightTilt: 20 });
  const d = Math.abs(((m.flightLeanBearingDeg - b + 540) % 360) - 180);
  check('lean bearing ' + b + '° recovered', d < 15,
    'got ' + (m.flightLeanBearingDeg == null ? 'null' : m.flightLeanBearingDeg.toFixed(0)));
});

// ================= REGRESSIONS (bugs found in the field) =================
console.log('\n— regressions —');
{
  // Was: peak-g divided by the captured gravity magnitude; a near-free-fall gref of ~45
  // turned a normal 13,000 into "266 g".
  const m = analyze({ gref: [10, 20, 40] });
  check('peak-g ignores a tiny/invalid gravity reference', m.peakG < 14,
    'peakG ' + m.peakG.toFixed(1));
}
{
  // ±8 g per axis ⇒ magnitude can never exceed sqrt(3)*8 = 13.86
  const m = analyze({});
  check('peak-g respects the sqrt(3)x8g ceiling', m.peakG <= 13.87, 'peakG ' + m.peakG.toFixed(2));
}
{
  // Was: an invalid (free-fall) reference still produced a confident reach-back angle.
  const m = analyze({ gref: [5, 5, 20], still: 0, spike: 2 });
  check('invalid gravity ref ⇒ angle withheld or sanely derived',
    m.releaseTiltDeg === null || (m.releaseTiltDeg >= 0 && m.releaseTiltDeg <= 90),
    'tilt ' + m.releaseTiltDeg);
}
{
  // Was: USB + Bluetooth both connected ⇒ every line received twice, interleaved,
  // which scrambled the phase fit.
  const src = makeThrow({ rpm: 480 }).split('\n');
  const dup = [];
  src.forEach((l, i) => { dup.push(l); if (i > 2 && i % 2 === 0) dup.push(src[i - 1]); });
  const m = analyzeThrow(parseThrows(dup.join('\n'))[0]);
  near('duplicated/interleaved samples deduped', m.rpm, 480, 30);
}
{
  // Was: "release" was the global max, but a net impact is a BIGGER, LATER spike, so the
  // analyzer measured the post-impact tumble instead of the flight.
  const m = analyze({ rpm: 480, impactAfter: true });
  near('net impact does not hijack the release', m.rpm, 480, 40);
}
{
  // Was: noise produced a confident phantom RPM (e.g. 418 from a disc slid on a table).
  const m = analyze({ spin: false, magAmp: 0 });
  check('no rotation ⇒ RPM withheld, not invented',
    m.rpm === null, 'rpm ' + m.rpm);
  check('no rotation ⇒ warns why', m.warnings.some(w => /rotation/i.test(w)), m.warnings.join('|'));
}
{
  // Was: a corrupted timestamp produced a negative sample rate (-378 Hz).
  const rows = makeThrow({}).split('\n');
  const i = rows.findIndex(r => /^\d+,/.test(r)) + 25;
  rows[i] = rows[i].replace(/^\d+/, '999999');       // one wild timestamp
  const m = analyzeThrow(parseThrows(rows.join('\n'))[0]);
  check('corrupt timestamp ⇒ sample rate stays sane',
    m.sampleRateHz > 0 && m.sampleRateHz < 1000, 'rate ' + m.sampleRateHz);
}
{
  // Booth requirement: a partial capture must still show a power number, never a blank.
  const t = parseThrows('# throw 1 gref=0,0,1024\nt,x,y,z,mx,my\n0,8000,0,0,10,5\n10,100,0,1000,11,6\n')[0];
  const m = analyzeThrow(t);
  check('partial capture still reports peak-g', m.peakG != null && m.peakG > 1,
    'peakG ' + m.peakG);
}
{
  const m = analyze({ rpm: 900, hz: 30 });   // 900 RPM = 15 Hz spin, needs >30 Hz
  check('under-sampled spin is flagged (aliasing)',
    m.warnings.some(w => /alias|too low/i.test(w)) || m.rpm === null,
    'rpm ' + m.rpm + ' warns: ' + m.warnings.join('|'));
}
{
  const m = analyze({ noMag: true });
  check('missing magnetometer ⇒ no RPM but no crash', m.rpm === null);
  check('missing magnetometer ⇒ power still reported', m.peakG != null);
}

// ================= ROBUSTNESS / FUZZ =================
console.log('\n— robustness —');
const hostile = {
  'empty sample list': { samples: [] },
  'single sample': { samples: [{ t: 0, x: 1, y: 1, z: 1, total: 2, mx: 1, my: 1 }] },
  'all zeros': { samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 10, x: 0, y: 0, z: 0, total: 0, mx: 0, my: 0 })) },
  'identical timestamps': { samples: Array.from({ length: 40 }, () => ({ t: 5, x: 1, y: 1, z: 1024, total: 1024, mx: 1, my: 1 })) },
  'NaN values': { samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 10, x: NaN, y: NaN, z: NaN, total: NaN, mx: NaN, my: NaN })) },
  'nulls in fields': { samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 10, x: null, y: null, z: null, total: null, mx: null, my: null })) },
  'reversed timestamps': { samples: Array.from({ length: 40 }, (_, i) => ({ t: (40 - i) * 10, x: 1, y: 1, z: 1024, total: 1024, mx: 10, my: 5 })) },
  'huge values': { samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 10, x: 1e12, y: -1e12, z: 1e12, total: 1e12, mx: 1e9, my: -1e9 })) },
};
for (const [name, obj] of Object.entries(hostile)) {
  let ok = true, why = '';
  try {
    const m = analyzeThrow(obj);
    const bad = v => v != null && (isNaN(v) || !isFinite(v));
    if (bad(m.peakG) || bad(m.rpm) || bad(m.releaseTiltDeg) || bad(m.sampleRateHz) || bad(m.spinWobbleDeg)) {
      ok = false; why = 'produced NaN/Infinity';
    }
  } catch (e) { ok = false; why = 'threw ' + e.message; }
  check('survives ' + name, ok, why);
}
// random fuzz — never throw, never emit NaN
for (let i = 0; i < 250; i++) {
  const n = Math.floor(Math.random() * 60);
  const samples = Array.from({ length: n }, (_, k) => ({
    t: Math.random() < 0.1 ? Math.round(R(1e6)) : k * 8,
    x: R(9000), y: R(9000), z: R(9000), total: Math.abs(R(14000)),
    mx: Math.random() < 0.1 ? NaN : R(60), my: Math.random() < 0.1 ? NaN : R(60),
  }));
  try {
    const m = analyzeThrow({ samples, gravityRef: null });
    const bad = v => v != null && (isNaN(v) || !isFinite(v));
    if (bad(m.peakG) || bad(m.rpm) || bad(m.sampleRateHz)) {
      check('fuzz iteration ' + i, false, 'NaN/Infinity from random input'); break;
    }
  } catch (e) { check('fuzz iteration ' + i, false, 'threw ' + e.message); break; }
}
check('250 random fuzz inputs handled', true);

// ---------- report ----------
console.log('\n' + '='.repeat(58));
if (fail) {
  console.log('FAILED  ' + fail + ' of ' + (pass + fail));
  failures.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('PASSED  all ' + pass + ' checks');
