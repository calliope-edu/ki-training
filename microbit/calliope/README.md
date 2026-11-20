# Calliope ML data program

The program the trainer puts on a Calliope mini to record motion data. One
C++ source (`source/`) builds for both boards:

| board | runtime | build config | output |
| --- | --- | --- | --- |
| mini 1/2 (nRF51822) | Calliope microbit-dal (`v2.2.0-rc6-calliope.rc5`, 32 KB RAM) | `dal/` | `out/ml-data-dal.hex` |
| mini 3 (nRF52833) | Calliope codal-microbit-v2 | `codal/` | `out/ml-data-codal.hex` |

Over **Bluetooth** it is the data collection program the trainer has always
used: the standard micro:bit accelerometer, button, LED, IO pin and UART
services, the name pattern on the display, a smiley on connect/disconnect.
Accelerometer range and period are the runtime defaults (2 g, 20 ms), as in
the ML extension's program on the mini.

Over **USB** it additionally streams the accelerometer every 20 ms and every
button change on the serial port (115200 baud; mini 2 through the J-Link
CDC bridge, mini 3 through DAPLink). The stream runs from boot without any
command, so a host such as Calliope Campus gets motion data without
Bluetooth. The Blocks runtime is not involved; on the mini 2 it has no room
for this.

## USB wire format

Frames use the Blocks runtime's serial framing, so the connection widget's
codec (`mini-connection-widget/src/blocks-frame.ts`, `BlocksFrameParser`)
parses them unchanged:

```
[0xFF (SFD), type, ch_hi, ch_lo, len, data[len], chk]    chk = sum(all preceding bytes) % 0xFF
```

Channels are in their own `0x02xx` range, so nothing mistakes the program for
the Blocks runtime (which uses `0x01xx`):

| channel | type | when | data |
| --- | --- | --- | --- |
| `0x0200` ML_INFO | `0x01` RES_READ | reply to the host's `FF 01 02 00` (REQ_READ 0x0200), and once per second unprompted | `[hardware (1 = mini 1/2, 2 = mini 3), 0x4D ('M'), protocol version (1), firmware build (1), sample period ms (20), range g (2), motion resyncs since boot (wraps), worst motion lateness in ms since the last ML_INFO, uptime in s as uint16 LE]` |
| `0x0203` MOTION | `0x21` NOTIFY | every 20 ms | X, Y, Z as int16 little-endian in milli-g (the values the BLE accelerometer service sends, not negated), then a uint8 sequence number wrapping at 256 |
| `0x0210` BUTTON | `0x21` NOTIFY | on each change | `[button (1 = A, 2 = B), state (0 = released, 1 = pressed, 2 = long press, as the BLE button service)]` |

Samples are paced against an absolute 20 ms deadline (no drift from the
scheduler tick). After a short stall (up to 120 ms; the mini 2 stalls about
50 ms now and then next to BLE) the missed samples are sent at once to catch
up; after a longer one the loop resynchronises and counts a resync. On the
mini 3, a sample is dropped if the TX buffer has no room, and the sequence
number shows the gap. The host stamps samples on arrival, as with Bluetooth.

What a host has to do (connection widget / Campus):

- Recognise the program by an `0x0200` frame whose `data[1]` is `0x4D`.
- Not count `0x02xx` frames towards the Blocks runtime's "N valid frames"
  fallback in `program-type.ts` (`probeUsb`, `probeJlinkSerial`), or the
  program is reported as the Blocks runtime.
- Relay `0x0203` and `0x0210` unthrottled.

## Measured (2026-11-19)

Measured with `tools/measure.py` (USB: frames per second and sequence gaps on
the serial port; BLE: notifications of the accelerometer data characteristic).

| board | transport | rate | lost | at rest x / y / z (milli-g) |
| --- | --- | --- | --- | --- |
| mini 3 | old data collection program, BLE | 50.3/s | – | -144 / -138 / -959 |
| mini 3 | USB alone (60 s) | 50.0/s | 0 | -275 / -103 / -934 (board moved since the row above) |
| mini 3 | BLE alone | 50.6/s | – | -145 / -140 / -959 |
| mini 3 | USB and BLE at once (BLE 60 s, USB 35 s) | USB 50.0/s, BLE 50.2/s | 0 | -275 / -103 / -934 on both |
| mini 2 | old data collection program, BLE | 231.8 notifications/s (bursts, see below) | – | -690 / 348 / -691 |
| mini 2 | USB alone (12 s) | 49.5/s | 0 | -688 / 349 / -692 |
| mini 2 | USB alone, untouched (300 s) | 49.3/s | 0 | – |
| mini 2 | USB and BLE at once (BLE 120 s, USB 140 s) | USB 49.4/s, BLE 163 notifications/s | 0 | -28 / 878 / -577 on both |
| mini 2 | USB with button presses (174 s) | 49.4/s | 0 | A, B, A held: all 7 button frames arrived |
| mini 2 | USB alone, untouched, reopening a silent port (25 min) | 49.2/s | 301 (two port stalls) | -30 / 858 / -606 |

At the same position the USB stream and BLE agree to within the sensor noise
(sd 4–13 milli-g), and both match the old data collection program; range is
2 g on all of them.

The mini 2's USB rate is 49.3–49.5/s rather than 50.0: no sequence gaps and no
resyncs, so the DAL's millisecond clock (6 ms ticks) runs about 1 % slow
against the PC. Over BLE the DAL accelerometer service notifies on every
sensor update, in bursts (median spacing under 1 ms); the old data collection
program does the same, so that is unchanged behaviour, not part of this
program.

**mini 2 serial TX.** With microbit-dal's interrupt-driven `serial.send`, the
mini 2's USB stream died for good (BLE still advertising) as soon as a send
came while the previous frame was still going out: after button presses, and
within seconds once stalled samples were caught up in a burst. The DAL build
therefore writes frames byte by byte with `putc` (about 1.1 ms busy wait per
frame); the CODAL build keeps the interrupt-driven send.

**J-Link CDC.** On the mini 2 the USB serial link (J-Link OB or the PC driver) stops
delivering now and then while the program keeps sending: in a 25-minute
untouched run it happened twice (after 6 and 21 minutes). The uptime in
ML_INFO ran on without a break (61 s to 1543 s), so the mini did not reset;
closing and reopening the port brought the stream back at once. With a
3-second silence check before reopening, the run lost 301 of about 74,000
samples and averaged 49.2/s. A host must therefore reopen the port when no
frame (not even the 1 Hz ML_INFO) arrived for a few seconds; `measure.py`
does exactly that.

Two early mini 3 runs read only 36–43 samples/s over USB with no gap in the
sequence numbers, so the device itself produced fewer; neither could be
reproduced in later runs (clean builds, 40–60 s, with and without BLE: 50.0/s,
no resync). ML_INFO bytes 6–7 (resync count, worst lateness per second) let a
host see this happen in the field.

## Shipped hexes

`src/device/firmware/calliope-ml-data-dal.hex` (mini 1/2) and
`src/device/firmware/calliope-ml-data-codal.hex` (mini 3) are the builds measured
below. Nothing in the trainer loads them yet; the standalone trainer still
flashes `universal-hex.hex`. Switching the trainer (and Campus) to them is a
separate step.

## Build

Needs WSL with Docker (`pext/yotta:update-yotta3`), arm-none-eabi-gcc, cmake
and python3, and a calliope-dev checkout to borrow the staged yotta modules
(DAL) and codal libraries (CODAL) from; see the paths at the top of
`build.sh`.

```
wsl bash microbit/calliope/build.sh          # both; or: dal | codal
```

The CODAL libraries bake in the bootloader of their codal-microbit-v2 pin.
The shipped mini 3 hex carries the bootloader the previous data collection
program carried (25580 bytes, md5 `b6b60be32a3f89b89bfb7974e7c6f10d`);
`build.sh` swaps it in with `tools/swap_bootloader.py`, taking the region
from the mini 3 part of `src/device/firmware/universal-hex.hex`.

## Measure

```
python -I tools/measure.py usb COM9 20
python -I tools/measure.py ble "Calliope mini" 15
python -I tools/measure.py both COM9 "Calliope mini" 15
```

Building with `-DML_DEBUG_TIMING` (or a `#define` at the top of `MlUsb.cpp`)
adds a once-per-second `0x02F0` frame with the motion loop's timing, which
`measure.py` prints.
