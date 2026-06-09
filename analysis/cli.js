#!/usr/bin/env node
/* Disc-o-tech CLI — analyze a CSV from the terminal:
 *   node cli.js ../data/sample-throw.csv
 * Prints one row of metrics per detected throw. */
'use strict';
const fs = require('fs');
const { parseThrows, analyzeThrow } = require('./metrics.js');

const file = process.argv[2];
if (!file) { console.error('usage: node cli.js <data.csv>'); process.exit(1); }

const throwsArr = parseThrows(fs.readFileSync(file, 'utf8'));
if (!throwsArr.length) { console.error('No data rows found.'); process.exit(1); }

const f = (v, d = 0) => (v == null || isNaN(v)) ? '—' : (+v).toFixed(d);
const table = throwsArr.map((t, i) => {
  const m = analyzeThrow(t);
  return {
    throw: i + 1,
    RPM: f(m.rpm),
    'reach°': f(m.releaseTiltDeg, 1),
    'flight°': f(m.flightTiltDeg, 1),
    'lean°N': f(m.flightLeanBearingDeg, 0),
    'peak_g': f(m.peakG, 1),
    'wobble°': f(m.spinWobbleDeg, 1),
    'rate_Hz': f(m.sampleRateHz, 0),
    n: m.n,
  };
});
console.table(table);
throwsArr.forEach((t, i) => {
  const m = analyzeThrow(t);
  if (m.warnings.length) console.log(`throw ${i + 1} ⚠  ${m.warnings.join('\n     ')}`);
});
