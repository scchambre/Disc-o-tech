/* Generates data/sample-throw.csv — a synthetic but realistic putt-speed throw
 * so the analyzer works out of the box. Run: node make-sample.js */
'use strict';
const fs = require('fs');

const HZ = 100, dt = 1000 / HZ;
const SPIN_HZ = 8;            // 8 rev/s = 480 RPM
const TILT_DEG = 12, TILT_DIR = 30;   // disc leaned 12°, toward 30° in its own frame
const rand = (a) => (Math.random() - 0.5) * 2 * a;

const rows = [];
let t = 0;
// gravity vector for a disc tilted TILT_DEG toward TILT_DIR (units ~1000/g)
const gz = Math.cos(TILT_DEG * Math.PI / 180) * 1000;
const gh = Math.sin(TILT_DEG * Math.PI / 180) * 1000;
const gx = gh * Math.cos(TILT_DIR * Math.PI / 180);
const gy = gh * Math.sin(TILT_DIR * Math.PI / 180);

function push(x, y, z, mx, my) {
  const total = Math.round(Math.hypot(x, y, z));
  rows.push([Math.round(t), Math.round(x), Math.round(y), Math.round(z), total, Math.round(mx), Math.round(my)]);
  t += dt;
}

// 1) still reach-back (gravity reference lives here)
for (let i = 0; i < 30; i++) push(gx + rand(8), gy + rand(8), gz + rand(8), 300 + rand(4), 100 + rand(4));
// 2) the release "hit" — clips the ±8 g range
for (let i = 0; i < 4; i++) push(rand(3000), rand(3000), 8000 - i * 400, 300 + rand(40), 100 + rand(40));
// 3) flight: disc spins; magnetometer traces sine waves at SPIN_HZ
for (let i = 0; i < 70; i++) {
  const th = 2 * Math.PI * SPIN_HZ * (t / 1000);
  const amp = 250 * (1 - i / 200);                       // gentle decay
  const accT = 1800 - i * 8 + 200 * Math.cos(th) + rand(60);  // some accel oscillation
  push(accT * 0.3 + rand(40), accT * 0.2 + rand(40), accT + rand(40),
       300 + amp * Math.cos(th) + rand(10), 100 + amp * Math.sin(th) + rand(10));
}

const csv = 'time (milliseconds),x,y,z,total,mx,my\n' + rows.map(r => r.join(',')).join('\n') + '\n';
fs.writeFileSync(__dirname + '/sample-throw.csv', csv);
console.log('wrote sample-throw.csv (' + rows.length + ' rows, expect ~' + (SPIN_HZ * 60) + ' RPM, ~' + TILT_DEG + '° tilt)');
