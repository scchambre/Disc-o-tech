/* Disc-o-tech — SINGLE micro:bit, USB + BLUETOOTH, with PRE-ROLL (micro:bit V2)
 * ================================================================
 * Continuously records into a rolling buffer, so when a throw is detected it
 * already holds the previous ~5 seconds: your run-up, the x-step (where the
 * disc sits nearly still), and the throw itself + early flight.
 *
 * Streams over BOTH USB (always) and Bluetooth (when a browser is connected).
 * LED: two top corners = Bluetooth not connected; center dot = connected.
 *
 * No button needed for real throws — the acceleration spike auto-triggers.
 * Button A just dumps the current buffer (handy for bench testing).
 *
 * LOAD: a project with the "bluetooth" extension + Project Settings →
 * "No Pairing Required" ON. Paste in the { } JavaScript view → Download.
 */

serial.setBaudRate(BaudRate.BaudRate115200)
input.setAccelerometerRange(AcceleratorRange.EightG)
bluetooth.startUartService()
music.setVolume(255)     // MAX volume for a loud room

// ---- tuning ----
const RING = 90          // samples per throw. Keep this SMALL: the Bluetooth stack reserves a large
                         // slice of RAM and dumping builds one string per sample, so an oversized
                         // ring can exhaust memory mid-dump and panic the board.
const SAMPLE_PAUSE = 5   // smaller = faster sampling (higher RPM ceiling) UNTIL the magnetometer's
                         // own refresh rate caps it. Watch "rate Hz" in the analyzer to see what you get.
const POST_MS = 500      // record this long AFTER the throw spike. MUST stay well under
                         // RING * (actual ms per sample) (~90 x 8ms = 720ms), otherwise the post-throw
                         // samples wrap the ring and overwrite the release spike the analyzer needs.
const TRIGGER_MG = 3000  // throw detection (~3 g), de-bounced below so handling doesn't false-trigger
const STILL_MG = 1300    // below this counts as "still" (used to re-arm after a throw)
// A valid gravity reading sits NEAR 1 g. Only sample the reference inside this band —
// below it is free-fall and above it is mid-handling, and both point the wrong way.
const GREF_LO = 900
const GREF_HI = 1180
const OUT_PAUSE = 30     // ms between Bluetooth lines. BLE is slow — keep at 30 for reliable wireless.

// ---- rolling buffer (pre-allocated so we never allocate mid-throw) ----
let rt: number[] = []
let rx: number[] = []
let ry: number[] = []
let rz: number[] = []
let rmx: number[] = []
let rmy: number[] = []
for (let i = 0; i < RING; i++) { rt.push(0); rx.push(0); ry.push(0); rz.push(0); rmx.push(0); rmy.push(0) }
let widx = 0
let filled = 0

let grx = 0, gry = 0, grz = 1024
let throwId = 0
let armed = true
let connected = false

bluetooth.onBluetoothConnected(function () {
    connected = true
    music.playTone(Note.C, 150)        // rising two-note = connected
    music.playTone(Note.G, 150)
    basic.showIcon(IconNames.Yes); basic.pause(300); basic.clearScreen()
})
bluetooth.onBluetoothDisconnected(function () {
    connected = false
    music.playTone(Note.G, 150)        // falling two-note = disconnected
    music.playTone(Note.C, 150)
})

function emit(line: string) {
    // Send over Bluetooth if a browser is connected, else USB serial — NEVER both,
    // so the analyzer can't receive (and double-count) every line twice.
    if (connected) bluetooth.uartWriteLine(line)
    else serial.writeLine(line)
}

// record one sample into the rolling buffer; return its acceleration strength
function record(): number {
    const ax = input.acceleration(Dimension.X)
    const ay = input.acceleration(Dimension.Y)
    const az = input.acceleration(Dimension.Z)
    rt[widx] = input.runningTime()
    rx[widx] = ax
    ry[widx] = ay
    rz[widx] = az
    // round the magnetometer: shorter strings at dump time = less memory churn
    rmx[widx] = Math.round(input.magneticForce(Dimension.X))
    rmy[widx] = Math.round(input.magneticForce(Dimension.Y))
    const mag = Math.sqrt(ax * ax + ay * ay + az * az)
    if (mag > GREF_LO && mag < GREF_HI) { grx = ax; gry = ay; grz = az }   // only when it IS ~1 g
    widx = (widx + 1) % RING
    if (filled < RING) filled += 1
    return mag
}

let dumping = false

function dumpRing() {
    if (dumping) return            // never re-enter (e.g. button A pressed mid-dump)
    dumping = true
    basic.showIcon(IconNames.SmallDiamond)
    throwId += 1
    emit("# throw " + throwId + " gref=" + grx + "," + gry + "," + grz)
    emit("t,x,y,z,mx,my")
    const n = filled
    for (let k = 0; k < n; k++) {
        const i = (((widx - n + k) % RING) + RING) % RING   // oldest -> newest
        emit(rt[i] + "," + rx[i] + "," + ry[i] + "," + rz[i] + "," + rmx[i] + "," + rmy[i])
        basic.pause(OUT_PAUSE)
    }
    emit("# end")
    widx = 0; filled = 0        // clear the buffer so the next throw can't include stale samples
    basic.showIcon(IconNames.Yes); basic.pause(200); basic.clearScreen()
    dumping = false
}

// Button A = dump the current buffer now (no throw needed).
input.onButtonPressed(Button.A, function () { dumpRing() })

basic.forever(function () {
    const s = record()
    if (armed && s > TRIGGER_MG) {
        basic.pause(10)
        if (input.acceleration(Dimension.Strength) > TRIGGER_MG) {   // still high 10ms later = a real throw, not a bump
            armed = false
            const tEnd = input.runningTime() + POST_MS
            while (input.runningTime() < tEnd) { record(); basic.pause(SAMPLE_PAUSE) }
            dumpRing()
            // wait until still again, but TIME OUT after 3 s so it can never get stuck un-armed
            let waited = 0
            while (input.acceleration(Dimension.Strength) > STILL_MG && waited < 3000) { basic.pause(50); waited += 50 }
            basic.pause(300)
            armed = true
            music.playTone(Note.E, 120); basic.pause(70); music.playTone(Note.E, 120)   // 2 "ready" beeps
        }
    } else if (armed) {
        if (connected) led.plot(2, 2)
        else { led.plot(0, 0); led.plot(4, 0) }
    }
    basic.pause(SAMPLE_PAUSE)
})
