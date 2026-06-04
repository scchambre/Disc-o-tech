# Data

Drop your throw captures here (CSV).

- `sample-throw.csv` — synthetic demo throw (regenerate with `node make-sample.js`).
  Expected result: ~480 RPM, ~12° release tilt, clipped peak G.
- `make-sample.js` — generator for the above; handy for testing the analyzer offline.

## Capture formats the analyzer understands

Columns are matched **by name**, so both sources just work:

- **Datalogger USB export** (`MY_DATA.HTM` → Download):
  `time (milliseconds),x,y,z,total,mx,my`
- **Live serial** from the base station, with per-throw markers:
  ```
  # throw 3 gref=12,-40,1018
  t,x,y,z,mx,my
  0,120,-30,8050,45,-12
  ...
  # end
  ```

`gref=` carries the gravity reference (disc-still orientation) for the release-angle
calculation. Lines starting with `#` separate throws; a plain datalogger CSV (no markers) is
treated as a single throw.

> Tip: name real captures something meaningful like `2026-06-04_putt_flat_vs_hyzer.csv` so the
> analyzer's row labels stay readable.
