/* Disc-o-tech — SINGLE micro:bit, USB + BLUETOOTH at once (micro:bit V2)
 * ================================================================
 * Streams every throw over BOTH the USB cable (always) and Bluetooth (when a
 * browser is connected). So the cable is your guaranteed fallback while you
 * sort out the wireless link — no firmware switching.
 *
 * The LED tells you the Bluetooth state:
 *   • two top corners lit  = Bluetooth NOT connected (USB still works)
 *   • single center dot    = Bluetooth connected
 *
 * ----- LOAD -----
 *  Use a project that has the "bluetooth" extension added AND
 *  Project Settings → "No Pairing Required" turned ON, then paste this in
 *  the { } JavaScript view and Download. (If you still have your earlier
 *  Bluetooth project, paste it there — it already has both.)
 */

serial.setBaudRate(BaudRate.BaudRate115200)
input.setAccelerometerRange(AcceleratorRange.EightG)
bluetooth.startUartService()

const MAX_SAMPLES = 200
const CAPTURE_MS = 1500
const TRIGGER_MG = 2600
const STILL_MG = 1300
const SAMPLE_PAUSE = 5
const OUT_PAUSE = 30   // ms between Bluetooth lines. BLE is slow — too fast drops the
                       // tail of each line (mx,my). 30ms is reliable; lower only if USB-only.

let bt: number[] = []
let bx: number[] = []
let by: number[] = []
let bz: number[] = []
let bmx: number[] = []
let bmy: number[] = []

let grx = 0, gry = 0, grz = 1024
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

// send one line over USB always, and over Bluetooth when connected
function emit(line: string) {
    serial.writeLine(line)
    if (connected) bluetooth.uartWriteLine(line)
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
    emit("# throw " + throwId + " gref=" + grx + "," + gry + "," + grz)
    emit("t,x,y,z,mx,my")
    for (let i = 0; i < bt.length; i++) {
        emit(bt[i] + "," + bx[i] + "," + by[i] + "," + bz[i] + "," + bmx[i] + "," + bmy[i])
        basic.pause(OUT_PAUSE)
    }
    emit("# end")
    basic.showIcon(IconNames.Yes)
    basic.pause(200)
    basic.clearScreen()
}

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
        if (connected) led.plot(2, 2)
        else { led.plot(0, 0); led.plot(4, 0) }
        if (s < STILL_MG) {
            grx = input.acceleration(Dimension.X)
            gry = input.acceleration(Dimension.Y)
            grz = input.acceleration(Dimension.Z)
        }
    }
    basic.pause(15)
})
