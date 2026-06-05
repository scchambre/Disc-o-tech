# Analysis

Pure JavaScript, no build step. Same math runs in the browser and in Node.

## Browser (recommended)

Open `index.html` (double-click, or serve the folder). Two ways to get data in:

- **Load CSV** — drag a `MY_DATA` export (or any saved capture) onto the drop zone.
- **Connect via Bluetooth** — single-board build (`disc-microbit-bluetooth`). Pick
  `BBC micro:bit [xxxxx]` from the picker; throws appear automatically. Web Bluetooth, Chrome/Edge.
- **USB base station** — live serial from the 2-board radio receiver. Each throw appears
  automatically. Web Serial, Chrome/Edge.

*(If a live button does nothing from `file://`, serve the folder instead: `npx serve` or
`python3 -m http.server`, then open the printed `http://localhost…` URL. Make sure system
Bluetooth is on, and allow the browser's Bluetooth permission prompt.)*

Click any row to plot that throw (acceleration + the magnetometer sine waves). The table is
built for **comparing throws** — change your form, throw again, watch RPM / tilt / wobble
move. **Export table CSV** saves the comparison.

## Terminal

```bash
node cli.js ../data/sample-throw.csv     # or:  npm run demo
```

## Reading the columns

| Column | Meaning |
|--------|---------|
| **RPM** | spin rate from the magnetometer phase |
| **tilt°** | how far the disc's axis leaned at release (hyzer + nose combined, in the disc's frame) |
| **tilt dir°** | direction of that lean within the disc |
| **peak g** | hardest acceleration in the throw (≈8 = clipped the micro:bit's range) |
| **spin wobble %** | spin-rate variability — lower = cleaner, smoother release |
| **rate Hz** | actual achieved sample rate (sanity-check vs. RPM for aliasing) |
| **⚠** | count of warnings; hover the plot title to read them |

If RPM shows an aliasing warning, your sample rate was below ~2× the spin frequency — fine for
putts, but drives need a gyro-equipped IMU (see `../docs/HARDWARE.md`).

## Files
- `metrics.js` — parsing + flight math (shared by browser & Node; no dependencies)
- `plot.js` — minimal canvas charts
- `app.js` — browser UI glue (file load, Web Serial, table, export)
- `cli.js` — Node entry point
