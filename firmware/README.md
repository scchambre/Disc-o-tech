# Firmware (micro:bit V2)

Requires **micro:bit V2** (V1 has no data logger and a weaker radio). There are **two builds —
pick one** depending on how many boards you have. They produce different `.hex` files.

| Build | Boards | Transport | Folder(s) |
|-------|--------|-----------|-----------|
| **A — Radio** | 2 | micro:bit radio → USB serial | `disc-microbit/` + `base-station-microbit/` |
| **B — Bluetooth** | 1 | Bluetooth UART → laptop/phone | `disc-microbit-bluetooth/` |

Both stream the **same CSV format**, so the analyzer works with either.

## Loading (applies to every file)

Written for the MakeCode **JavaScript** view (not the Python editor):

1. Go to <https://makecode.microbit.org> → **New Project**.
2. Click the **`{ } JavaScript`** toggle at the top.
3. Select-all, paste the contents of the `.ts` file over everything.
4. **Download** the `.hex` and copy it to the board's USB drive.

> The `{ } JavaScript` in MakeCode is "Static TypeScript" — close to JS but not 100% the same.
> If a name errors, switch to Blocks to confirm it, then back.

---

## Build A — Radio (2 boards)

### `disc-microbit/` — the disc board (hands-free)
- Auto-detects a throw via an acceleration spike, captures ~120–150 Hz into RAM, then beams
  every sample to the base station over radio.
- Tuning knobs at the top: `TRIGGER_MG` (throw sensitivity), `CAPTURE_MS` (record length),
  `SAMPLE_PAUSE` (rate). If picking the disc out of the net retriggers it, raise `TRIGGER_MG`.
- **Button A** forces a capture (handy for bench testing without throwing).

### `base-station-microbit/` — the receiver (stays on USB)
- Prints received throws as CSV over serial at 115200 baud.
- Watch it in MakeCode's **Show console Device**, or feed it into
  `analysis/index.html` → **USB base station**.

**Keep the radio groups matched:** both files use `radio.setGroup(7)`. Running multiple setups
nearby? Give each pair a unique group number (0–255) — change it in **both** files.

---

## Build B — Bluetooth (1 board)  ← start here with a single micro:bit

`disc-microbit-bluetooth/` is the same capture logic, but it streams each throw straight to
your laptop over **Bluetooth UART** — no second board.

**Three setup steps in MakeCode before you Download** (also in the file's header comment):

1. Gear ⚙ → **Extensions** → add **`bluetooth`**.
   It warns it will *remove the radio blocks* — that's expected; radio and Bluetooth can't
   share one board, which is exactly why this is a separate build.
2. Gear ⚙ → **Project Settings** → turn ON
   **"No Pairing Required: Anyone can connect via Bluetooth."** (Skips fiddly pairing.)
3. `{ } JavaScript` view → paste → **Download**.

**Receive it:** `analysis/index.html` → **Connect via Bluetooth** (Chrome/Edge), pick
`BBC micro:bit [xxxxx]`. The board shows two top-corner LEDs while waiting for a connection, a
center dot once connected. **Connect the browser before you throw** — if it isn't connected it
shows an ✗ and the throw isn't sent (it can only buffer one throw at a time).

---

## Limitations to expect (both builds)
- **Magnetometer speed:** the micro:bit's magnetometer updates relatively slowly, so very fast
  drive spin will alias (the analyzer flags this). Great for putts; drives need a gyro — see
  `../docs/HARDWARE.md`.
- **Throughput:** the dump sends one sample at a time with a small pause, so a throw takes a
  second or two to transfer — fine between throws. If samples drop, raise the pause
  (`basic.pause(4)` in radio `dumpThrow()`, or `BT_PAUSE` in the Bluetooth build).
