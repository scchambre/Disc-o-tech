# Firmware (micro:bit V2)

Two programs. Flash each to a **separate** micro:bit. Requires **micro:bit V2** (V1 has no
data logger and a weaker radio).

## Loading

These are written for the MakeCode **JavaScript** view (not the Python editor):

1. Go to <https://makecode.microbit.org> → **New Project**.
2. Click the **`{ } JavaScript`** toggle at the top.
3. Select-all, paste the contents of the `.ts` file over everything.
4. **Download** the `.hex` and copy it to the board's USB drive.

> The `{ } JavaScript` in MakeCode is "Static TypeScript" — close to JS but not 100% the same.
> If a block errors, switch to the Blocks view to confirm a name, then back. Tested against
> the standard `radio`, `input`, and `serial` namespaces.

## `disc-microbit/` — the disc board (hands-free)
- Auto-detects a throw via an acceleration spike, captures ~120–150 Hz into RAM, then beams
  every sample to the base station over radio.
- Tuning knobs at the top: `TRIGGER_MG` (throw sensitivity), `CAPTURE_MS` (record length),
  `SAMPLE_PAUSE` (rate). If picking the disc out of the net retriggers it, raise `TRIGGER_MG`.
- **Button A** forces a capture (handy for bench testing without throwing).

## `base-station-microbit/` — the receiver (stays on USB)
- Prints received throws as CSV over serial at 115200 baud.
- Watch it in MakeCode's **Show console Device**, or feed it straight into
  `analysis/index.html` → **Connect base station**.

## Important: keep the radio groups matched
Both files use `radio.setGroup(7)`. If you run multiple setups near each other, give each
pair a unique group number (0–255) — change it in **both** files.

## Limitations to expect
- **Magnetometer speed:** the micro:bit's magnetometer updates relatively slowly, so very
  fast drive spin will alias. Great for putts; for drives you need a gyro (see
  `../docs/HARDWARE.md`).
- **Radio throughput:** the dump sends one sample per packet with a small pause. ~200 samples
  takes a couple of seconds — fine between throws. If the base station drops samples, increase
  the `basic.pause(4)` in `dumpThrow()`.
