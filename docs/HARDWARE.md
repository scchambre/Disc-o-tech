# Hardware roadmap — replicating TechDisc on the cheap

TechDisc (~$250 USD) reports speed, spin, hyzer, nose, launch angle, wobble and advance
ratio. This doc is the plan to get as close as possible for **under ~$60**.

## The one insight that makes it work: measure *at release*, not in flight

TechDisc doesn't track the whole 4-second flight — that's impossible with inertial sensors
(double-integrating acceleration drifts wildly). Instead it characterizes the **moment of
release**, a window of maybe 50–150 ms:

1. **Reach-back (disc still):** gravity gives the starting orientation; zero the gyro bias.
2. **Release (accel spike):** marks the start of the launch window.
3. **Integrate the gyro** across that short window → orientation at release → hyzer / nose /
   launch angle. (Short window ⇒ bounded drift — this is the trick.)
4. **Spin** = gyro Z directly at release. No aliasing, no magnetometer tricks.
5. **Speed** = integrate (accel − gravity) over the short release window → launch velocity.
   Still the least accurate number; calibrate it against a radar gun or video once.
6. **Hyzer vs nose** are then separable, because step 5 gives the velocity vector to
   reference the orientation against.

**Every one of these needs a gyroscope. The micro:bit has none** — that's the hard ceiling,
and the reason for the upgrade below.

## Phased plan

| Phase | Cost (added) | Hardware | Unlocks |
|------|---------------|----------|---------|
| **0 — now** | $0 | micro:bit you have | Putting consistency: RPM, release tilt, wobble, peak G. Validate the whole pipeline. |
| **1 — wireless** | ~$15 | 2nd micro:bit (base station) | Hands-free throw→analyze loop (firmware already here). |
| **2 — the real thing** | ~$25 | **Seeed XIAO nRF52840 Sense** | Gyro + high sample rate + BLE → spin, angles, launch-window speed for **drives**. |
| **3 — big arms** | ~$20 | **ADXL375** (±200 g) breakout | Stops clipping on hard drives and off-center centripetal load. |

### Recommended board: Seeed XIAO nRF52840 **Sense** (~$25)
- Built-in 6-axis IMU (LSM6DS3TR-C): accel to ±16 g, **gyro to ±2000 °/s** (≈ 20,000 RPM
  headroom), output data rate to 6.6 kHz — plenty for any spin.
- Bluetooth LE (stream to a phone/laptop, like TechDisc) **and** USB-C.
- 2 MB onboard flash for logging, ~5 g, 21×17.5 mm — light and centerable on a disc.
- Programmable in **CircuitPython** (you said you can do Python) or Arduino C++.

### Why add the ADXL375 (±200 g) for driving
A disc spinning ~1200 RPM pulls **tens of g** of centripetal force a few cm off-center, and a
hard release "hit" spikes high too. The XIAO's ±16 g accel clips there. The ADXL375 reads up
to ±200 g, so the high-g channel (speed + centripetal) stays clean. The XIAO's gyro and the
ADXL375's high-g accel complement each other.

> Mounting matters: keep the electronics **light, low-profile, and as centered as possible**,
> or you change how the disc flies. Balance a counterweight opposite any battery.

## How this repo carries forward to Phase 2/3

The analyzer (`analysis/`) is deliberately sensor-agnostic — it matches CSV columns **by
name**. When you move to the XIAO:
- Output the same `time,x,y,z,mx,my` columns over USB/BLE and the existing tool just works.
- Add gyro columns (`gx,gy,gz`) and we extend `metrics.js` with a gyro→RPM path (replaces the
  magnetometer trick) and a release-window orientation integrator for true hyzer/nose.

CircuitPython on the XIAO can print the same CSV to the USB serial console, so the browser
analyzer's **Connect** button keeps working with zero changes.

## Cost comparison

| | Cost |
|---|---|
| TechDisc | ~$250 USD |
| Disc-o-tech Phase 2 (XIAO Sense + LiPo + bits) | ~$40 |
| Disc-o-tech Phase 3 (+ ADXL375) | ~$60 |

The gaps you won't fully close for free: factory calibration, a polished phone app, and
radar-validated speed. Speed especially will need a one-time calibration against a known
reference. Everything else is within reach.
