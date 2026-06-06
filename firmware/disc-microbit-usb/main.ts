/* Disc-o-tech — SINGLE micro:bit, USB CABLE build (micro:bit V2)
 * ================================================================
 * The simplest, most reliable way to test: no radio, no Bluetooth, no pairing.
 * The micro:bit streams each throw as CSV straight down the USB cable.
 *
 * Use this to confirm the whole pipeline works (capture + analysis). It's
 * tethered, so for bench testing just SHAKE or SPIN the board by hand, or do
 * a gentle toss while the cable is attached.
 *
 * ----- LOAD -----
 *  makecode.microbit.org → New Project (a fresh one — no extensions needed)
 *  → { } JavaScript → paste this → Download.
 *
 * ----- RECEIVE -----
 *  Keep the micro:bit plugged in. analysis/index.html → click
 *  "USB base station" → pick the port named "BBC micro:bit" (or cu.usbmodem…).
 *  Then shake the board: a row appears.
 */

serial.setBaudRate(BaudRate.BaudRate115200)
input.setAccelerometerRange(AcceleratorRange.EightG)

const MAX_SAMPLES = 200
const CAPTURE_MS = 1500
const TRIGGER_MG = 2600     // strength that starts a capture (~2.6 g). Lower it to ~1800 if a gentle shake won't trigger.
const STILL_MG = 1300
const SAMPLE_PAUSE = 5

let bt: number[] = []
let bx: number[] = []
let by: number[] = []
let bz: number[] = []
let bmx: number[] = []
let bmy: number[] = []

let grx = 0, gry = 0, grz = 1024
let throwId = 0
let armed = true

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
    serial.writeLine("# throw " + throwId + " gref=" + grx + "," + gry + "," + grz)
    serial.writeLine("t,x,y,z,mx,my")
    for (let i = 0; i < bt.length; i++) {
        serial.writeLine(bt[i] + "," + bx[i] + "," + by[i] + "," + bz[i] + "," + bmx[i] + "," + bmy[i])
        basic.pause(2)
    }
    serial.writeLine("# end")
    basic.showIcon(IconNames.Yes)
    basic.pause(200)
    basic.clearScreen()
}

// Button A = force a capture now (no shake needed).
input.onButtonPressed(Button.A, function () {
    throwId += 1
    captureThrow()
})

basic.forever(function () {
    const s = input.acceleration(Dimension.Strength)
    if (armed && s > TRIGGER_MG) {
        armed = false
        throwId += 1
        captureThrow()
        while (input.acceleration(Dimension.Strength) > STILL_MG) basic.pause(50)
        basic.pause(300)
        armed = true
    } else if (armed) {
        led.plot(2, 2)              // center dot = armed & waiting
        if (s < STILL_MG) {
            grx = input.acceleration(Dimension.X)
            gry = input.acceleration(Dimension.Y)
            grz = input.acceleration(Dimension.Z)
        }
    }
    basic.pause(15)
})
