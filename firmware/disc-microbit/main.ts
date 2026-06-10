/* Disc-o-tech — DISC micro:bit (V2 only)
 * ---------------------------------------------------------------
 * Tape this one to the disc. It runs hands-free:
 *   1. waits, watching for a throw (big acceleration spike)
 *   2. captures accel + magnetometer into RAM as fast as the sensors allow
 *      (from the throw forward — no run-up; watch "rate Hz" in the analyzer)
 *   3. beams every sample to the base-station micro:bit over radio
 *   4. waits until still, re-arms, and BEEPS when ready for the next throw
 * So you never unplug it — throw, fetch (wait for the beep), throw again.
 *
 * HOW TO LOAD: open https://makecode.microbit.org → New Project →
 * click the {} JavaScript toggle → paste this over everything → Download.
 *
 * Both micro:bits MUST use the same radio group (7 below).
 */

radio.setGroup(7)
radio.setTransmitPower(7)
input.setAccelerometerRange(AcceleratorRange.EightG)   // don't clip the throw
music.setVolume(255)                                   // MAX volume for a loud room

// ---- tuning knobs ----
const MAX_SAMPLES = 200      // RAM cap per throw
const CAPTURE_MS = 1500      // how long to record after a throw fires
const TRIGGER_MG = 3000      // strength that starts a capture (~3 g). Raised + de-bounced below
                             // so handling/carrying the disc doesn't false-trigger.
const STILL_MG = 1300        // below this counts as "still" (re-arm + gravity ref)
const SAMPLE_PAUSE = 5       // smaller = faster sampling (higher RPM ceiling) until the magnetometer caps it

// ---- capture buffers ----
let bt: number[] = []
let bx: number[] = []
let by: number[] = []
let bz: number[] = []
let bmx: number[] = []
let bmy: number[] = []

// last known gravity vector while the disc sat still (release-angle reference)
let grx = 0
let gry = 0
let grz = 1024
let throwId = 0
let armed = true

// send a 14-byte radio packet of 7 int16 values
function sendPacket(tag: number, a: number, b: number, c: number, d: number, e: number, f: number) {
    const buf = pins.createBuffer(14)
    buf.setNumber(NumberFormat.Int16LE, 0, tag)
    buf.setNumber(NumberFormat.Int16LE, 2, a)
    buf.setNumber(NumberFormat.Int16LE, 4, b)
    buf.setNumber(NumberFormat.Int16LE, 6, c)
    buf.setNumber(NumberFormat.Int16LE, 8, d)
    buf.setNumber(NumberFormat.Int16LE, 10, e)
    buf.setNumber(NumberFormat.Int16LE, 12, f)
    radio.sendBuffer(buf)
}

function captureThrow() {
    basic.showIcon(IconNames.Target)
    bt = []; bx = []; by = []; bz = []; bmx = []; bmy = []
    const start = input.runningTime()
    while (input.runningTime() - start < CAPTURE_MS && bt.length < MAX_SAMPLES) {
        bt.push(input.runningTime() - start)
        bx.push(input.acceleration(Dimension.X))
        by.push(input.acceleration(Dimension.Y))
        bz.push(input.acceleration(Dimension.Z))
        bmx.push(input.magneticForce(Dimension.X))
        bmy.push(input.magneticForce(Dimension.Y))
        basic.pause(SAMPLE_PAUSE)
    }
    dumpThrow()
}

function dumpThrow() {
    basic.showIcon(IconNames.SmallDiamond)
    const count = bt.length
    // HEADER: tag -1, throwId, count, gravity reference
    sendPacket(-1, throwId, count, grx, gry, grz, 0)
    basic.pause(6)
    // SAMPLES: tag = index, then t, ax, ay, az, mx, my
    for (let i = 0; i < count; i++) {
        sendPacket(i, bt[i], bx[i], by[i], bz[i], Math.round(bmx[i]), Math.round(bmy[i]))
        basic.pause(8)   // pace so the base station can keep up over USB serial (was 4 -> dropped ~24%)
    }
    // END: tag -2
    sendPacket(-2, throwId, 0, 0, 0, 0, 0)
    basic.showIcon(IconNames.Yes)
    basic.pause(300)
    basic.clearScreen()
}

// Button A = force a capture now (bench testing). B = nothing destructive.
input.onButtonPressed(Button.A, function () {
    throwId += 1
    captureThrow()
})

basic.forever(function () {
    const s = input.acceleration(Dimension.Strength)
    if (armed && s > TRIGGER_MG) {
        basic.pause(10)
        if (input.acceleration(Dimension.Strength) > TRIGGER_MG) {   // still high 10ms later = a real throw, not a bump
            armed = false
            throwId += 1
            captureThrow()
            // wait until still again, but TIME OUT after 3 s so it can never get stuck un-armed
            let waited = 0
            while (input.acceleration(Dimension.Strength) > STILL_MG && waited < 3000) { basic.pause(50); waited += 50 }
            basic.pause(300)
            armed = true
            music.playTone(Note.E, 120); basic.pause(70); music.playTone(Note.E, 120)   // 2 "ready" beeps
        }
    } else if (armed) {
        led.plot(2, 2)                 // dim center dot = armed & waiting
        if (s < STILL_MG) {            // update gravity reference while still
            grx = input.acceleration(Dimension.X)
            gry = input.acceleration(Dimension.Y)
            grz = input.acceleration(Dimension.Z)
        }
    }
    basic.pause(15)
})
