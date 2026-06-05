/* Disc-o-tech — SINGLE micro:bit, BLUETOOTH build (micro:bit V2 only)
 * ================================================================
 * No second board needed. The disc micro:bit captures a throw and streams
 * it straight to your laptop (or phone) over Bluetooth UART. The browser
 * analyzer reads it with "Connect via Bluetooth".
 *
 * This is a SEPARATE project from the radio firmware — Bluetooth and radio
 * cannot both be on one micro:bit, so you build a different .hex from this.
 *
 * ----- SETUP IN MAKECODE (do this BEFORE Download) -----
 *  1. makecode.microbit.org → New Project.
 *  2. Gear (⚙) → Extensions → search "bluetooth" → add it.
 *     It WARNS that it removes the radio blocks — that's expected here.
 *  3. Gear (⚙) → Project Settings → turn ON
 *        "No Pairing Required: Anyone can connect via Bluetooth."
 *     (Without this you'd have to pair, which is fiddly.)
 *  4. Click the { } JavaScript toggle → paste this over everything → Download.
 *
 * ----- RECEIVE ON LAPTOP -----
 *  analysis/index.html → "Connect via Bluetooth" (Chrome or Edge).
 *  Pick "BBC micro:bit [xxxxx]" from the list. Then throw.
 */

input.setAccelerometerRange(AcceleratorRange.EightG)   // don't clip the throw
bluetooth.startUartService()

// ---- tuning knobs (match the radio build) ----
const MAX_SAMPLES = 200
const CAPTURE_MS = 1500
const TRIGGER_MG = 2600     // strength that starts a capture (~2.6 g)
const STILL_MG = 1300       // below this = "still" (re-arm + gravity reference)
const SAMPLE_PAUSE = 5
const BT_PAUSE = 8          // ms between Bluetooth lines (raise if data drops)

// ---- capture buffers ----
let bt: number[] = []
let bx: number[] = []
let by: number[] = []
let bz: number[] = []
let bmx: number[] = []
let bmy: number[] = []

let grx = 0, gry = 0, grz = 1024     // gravity while still = release-angle reference
let throwId = 0
let armed = true
let connected = false

bluetooth.onBluetoothConnected(function () {
    connected = true
    basic.showIcon(IconNames.Yes)
    basic.pause(400)
    basic.clearScreen()
})
bluetooth.onBluetoothDisconnected(function () {
    connected = false
})

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
}

function dumpThrow() {
    basic.showIcon(IconNames.SmallDiamond)
    // header line is sent every throw so the analyzer is correct even if you
    // connect mid-session
    bluetooth.uartWriteLine("# throw " + throwId + " gref=" + grx + "," + gry + "," + grz)
    bluetooth.uartWriteLine("t,x,y,z,mx,my")
    for (let i = 0; i < bt.length; i++) {
        bluetooth.uartWriteLine(bt[i] + "," + bx[i] + "," + by[i] + "," + bz[i] + "," + bmx[i] + "," + bmy[i])
        basic.pause(BT_PAUSE)
    }
    bluetooth.uartWriteLine("# end")
    basic.showIcon(IconNames.Yes)
    basic.pause(200)
    basic.clearScreen()
}

// Button A = force a capture now (bench testing).
input.onButtonPressed(Button.A, function () {
    throwId += 1
    captureThrow()
    if (connected) dumpThrow()
    else { basic.showIcon(IconNames.No); basic.pause(500); basic.clearScreen() }
})

basic.forever(function () {
    const s = input.acceleration(Dimension.Strength)
    if (armed && s > TRIGGER_MG) {
        armed = false
        throwId += 1
        captureThrow()
        if (connected) {
            dumpThrow()
        } else {
            basic.showIcon(IconNames.No)   // connect the browser first!
            basic.pause(600)
            basic.clearScreen()
        }
        while (input.acceleration(Dimension.Strength) > STILL_MG) basic.pause(50)
        basic.pause(300)
        armed = true
    } else if (armed) {
        if (connected) led.plot(2, 2)            // center dot = armed & connected
        else { led.plot(0, 0); led.plot(4, 0) }  // two top corners = waiting for Bluetooth
        if (s < STILL_MG) {
            grx = input.acceleration(Dimension.X)
            gry = input.acceleration(Dimension.Y)
            grz = input.acceleration(Dimension.Z)
        }
    }
    basic.pause(15)
})
