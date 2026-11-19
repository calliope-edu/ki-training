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
| `0x0200` ML_INFO | `0x01` RES_READ | reply to the host's `FF 01 02 00` (REQ_READ 0x0200), and once per second unprompted | `[hardware (1 = mini 1/2, 2 = mini 3), 0x4D ('M'), protocol version (1), firmware build (1), sample period ms (20), range g (2)]` |
| `0x0203` MOTION | `0x21` NOTIFY | every 20 ms | X, Y, Z as int16 little-endian in milli-g (the values the BLE accelerometer service sends, not negated), then a uint8 sequence number wrapping at 256 |
| `0x0210` BUTTON | `0x21` NOTIFY | on each change | `[button (1 = A, 2 = B), state (0 = released, 1 = pressed, 2 = long press, as the BLE button service)]` |

Samples are paced against an absolute 20 ms deadline (no drift from the
scheduler tick). If the TX buffer has no room, that sample is dropped and the
sequence number shows the gap. The host stamps samples on arrival, as with
Bluetooth.

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
| mini 3 | USB alone (20 s) | 50.1/s | 0 | -146 / -146 / -958 |
| mini 3 | BLE alone | 50.6/s | – | -145 / -140 / -959 |
| mini 3 | USB and BLE at once (USB 27 s, BLE 15 s) | USB 50.1/s, BLE 50.3/s | 0 | same on both |

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
