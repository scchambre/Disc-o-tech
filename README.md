# Disc-o-tech 🥏

Low-cost disc-golf flight telemetry — a DIY take on the [TechDisc](https://shop.techdisc.com/).
A micro:bit (or, later, an IMU) rides on the disc and reports **spin (RPM)**, **release
angle**, **peak G**, and **spin wobble**, which a browser app turns into numbers you can
compare throw-to-throw.

## The hands-free loop (no unplugging between throws)

```
   DISC micro:bit                 radio                BASE-STATION micro:bit        laptop
  ┌────────────────┐   2.4GHz   ┌──────────────────┐   USB serial   ┌───────────────────────┐
  │ detect throw   │ ─────────► │ receive packets  │ ─────────────► │ analysis/index.html   │
  │ capture @120Hz │            │ print CSV serial │                │  → RPM, angle, table  │
  │ dump over radio│            └──────────────────┘                └───────────────────────┘
  └────────────────┘
```

Throw into the net → the disc auto-captures and beams the data to the receiver plugged into
your laptop → the analyzer shows the throw → fetch the disc → throw again. The board never
leaves the harness.

## Repo map

| Path | What it is |
|------|------------|
| `firmware/disc-microbit/main.ts`         | Disc board (2-board build): auto-detect → capture → radio dump |
| `firmware/base-station-microbit/main.ts` | Receiver board (2-board build): radio → CSV over USB serial |
| `firmware/disc-microbit-bluetooth/main.ts` | **Single-board build**: capture → Bluetooth UART → laptop |
| `analysis/index.html`                    | Browser analyzer (drag-drop CSV **or** live serial) |
| `analysis/metrics.js`                    | The flight-math engine (RPM, angle, wobble) |
| `analysis/cli.js`                        | Same math from the terminal: `node cli.js file.csv` |
| `data/sample-throw.csv`                  | A synthetic throw so everything works immediately |
| `docs/HARDWARE.md`                       | **The plan to actually match TechDisc** (parts + method) |

## Quick start (no hardware needed)

```bash
cd analysis
npm run demo          # analyzes data/sample-throw.csv  → ~480 RPM, 12° tilt
```

Then open `analysis/index.html` in your browser and drag `data/sample-throw.csv` onto it.

## Getting data off the micro:bit — three ways

1. **Bluetooth, ONE board (start here):** flash `disc-microbit-bluetooth` (see
   `firmware/README.md` for the 3 MakeCode setup steps), open the analyzer, click **Connect
   via Bluetooth**. No second board, no USB cable to the disc.
2. **Radio, TWO boards (the loop above):** flash the disc + base-station builds, plug the base
   station into USB, click **USB base station** in the analyzer. Throws stream in automatically.
3. **USB datalogger (no live view):** plug the disc board in, open `MY_DATA.HTM` on the
   `MICROBIT` drive, Download the CSV, drag it onto the analyzer.

> With a single micro:bit, use option 1. Add a second board later for option 2 (longer range,
> no Bluetooth fuss).

## What it measures — and the honest limits

| Metric | How | Reliable on micro:bit? |
|--------|-----|------------------------|
| **Spin / RPM** | magnetometer traces sine waves as the disc rotates; we fit the phase | ✅ for **putts**; ⚠️ fast drives alias (mag samples too slow) |
| **Release angle (tilt)** | gravity vector while the disc is still in reach-back | ✅ as a *combined* lean (see below) |
| **Peak G** | max accelerometer strength (set to ±8 g) | ✅ (but a hard drive clips 8 g) |
| **Spin wobble** | variability of the instantaneous spin rate | ✅ relative comparisons |
| **Speed (mph)** | — | ❌ not from inertial alone; use radar/video |
| **Hyzer vs nose, separately** | needs the flight-direction vector too | ❌ not from this sensor alone |

> **Why putting first?** Slower spin and lower G fit the micro:bit's limits, you're next to
> the laptop, and the whole point of putting is *consistency* — which is exactly what
> throw-to-throw RPM and release-angle variance measure.

To push into accurate **driving** numbers (real speed, separated hyzer/nose) you need a
**gyroscope** and higher sample rate — i.e. an IMU. See **[docs/HARDWARE.md](docs/HARDWARE.md)**
for the cheap parts list and the "measure-at-release" method TechDisc uses.

## License
MIT
