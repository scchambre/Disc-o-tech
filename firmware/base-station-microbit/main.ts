/* Disc-o-tech — BASE-STATION micro:bit
 * ---------------------------------------------------------------
 * This one stays plugged into your laptop via USB. It listens for the
 * disc's radio packets and prints them as CSV over the serial port, which
 * the browser analyzer (analysis/index.html → "Connect base station") reads
 * live. You can also watch it in MakeCode's "Show console Device" view.
 *
 * Load it the same way: makecode.microbit.org → JavaScript view → paste →
 * Download to the SECOND micro:bit. Same radio group as the disc (7).
 *
 * Output format (one throw):
 *   # throw 3 gref=12,-40,1018
 *   t,x,y,z,mx,my
 *   0,120,-30,8050,45,-12
 *   8,...
 *   # end
 */

radio.setGroup(7)
serial.setBaudRate(BaudRate.BaudRate115200)

radio.onReceivedBuffer(function (buf: Buffer) {
    const tag = buf.getNumber(NumberFormat.Int16LE, 0)
    if (tag == -1) {
        // HEADER: throwId, count, grx, gry, grz
        const id = buf.getNumber(NumberFormat.Int16LE, 2)
        const grx = buf.getNumber(NumberFormat.Int16LE, 6)
        const gry = buf.getNumber(NumberFormat.Int16LE, 8)
        const grz = buf.getNumber(NumberFormat.Int16LE, 10)
        serial.writeLine("# throw " + id + " gref=" + grx + "," + gry + "," + grz)
        // header every throw, so connecting the analyzer mid-session still parses
        serial.writeLine("t,x,y,z,mx,my")
        // keep the receive handler FAST (no slow LED rendering) so the sample burst
        // that follows doesn't overflow the radio queue
    } else if (tag == -2) {
        serial.writeLine("# end")
        basic.showIcon(IconNames.Yes)   // ✓ = a throw fully arrived (safe here — it's the last packet)
        basic.pause(120)
        basic.clearScreen()
    } else {
        // SAMPLE: tag = index, then t, x, y, z, mx, my
        const t = buf.getNumber(NumberFormat.Int16LE, 2)
        const x = buf.getNumber(NumberFormat.Int16LE, 4)
        const y = buf.getNumber(NumberFormat.Int16LE, 6)
        const z = buf.getNumber(NumberFormat.Int16LE, 8)
        const mx = buf.getNumber(NumberFormat.Int16LE, 10)
        const my = buf.getNumber(NumberFormat.Int16LE, 12)
        serial.writeLine(t + "," + x + "," + y + "," + z + "," + mx + "," + my)
    }
})

basic.forever(function () {
    led.plot(0, 4)        // bottom-left dot = listening
    basic.pause(500)
    led.unplot(0, 4)
    basic.pause(500)
})
