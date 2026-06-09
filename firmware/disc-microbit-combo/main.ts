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

// ---- tuning ----
const RING = 250         // samples kept in the rolling buffer (~5 s at ~50 Hz). Raise for a longer run-up.
const SAMPLE_PAUSE = 15  // ~50 Hz — plenty for run-up / x-step body motion
const POST_MS = 1000     // keep recording this long AFTER the throw spike (flight)
const TRIGGER_MG = 2600  // throw detection (~2.6 g). Lower toward 1800 for gentle tosses.
const STILL_MG = 1300    // "still" threshold (gravity reference + re-arm)
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
    serial.writeLine(line)
    if (connected) bluetooth.uartWriteLine(line)
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
    rmx[widx] = input.magneticForce(Dimension.X)
    rmy[widx] = input.magneticForce(Dimension.Y)
    if (ax * ax + ay * ay + az * az < STILL_MG * STILL_MG) { grx = ax; gry = ay; grz = az }
    widx = (widx + 1) % RING
    if (filled < RING) filled += 1
    return Math.sqrt(ax * ax + ay * ay + az * az)
}

function dumpRing() {
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
    basic.showIcon(IconNames.Yes); basic.pause(200); basic.clearScreen()
}

// Button A = dump the current buffer now (no throw needed).
input.onButtonPressed(Button.A, function () { dumpRing() })

basic.forever(function () {
    const s = record()
    if (armed && s > TRIGGER_MG) {
        armed = false
        const tEnd = input.runningTime() + POST_MS
        while (input.runningTime() < tEnd) { record(); basic.pause(SAMPLE_PAUSE) }
        dumpRing()
        while (input.acceleration(Dimension.Strength) > STILL_MG) basic.pause(50)  // wait until still
        basic.pause(300)
        armed = true
        music.playTone(Note.E, 120)        // "ready" beep — safe to throw again
    } else if (armed) {
        if (connected) led.plot(2, 2)
        else { led.plot(0, 0); led.plot(4, 0) }
    }
    basic.pause(SAMPLE_PAUSE)
})
