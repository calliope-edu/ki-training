# Plan: Campus KI-Training gets motion data over USB too

## Goal

In Campus mode (the trainer embedded in Calliope Campus with `?controller=2`), the
accelerometer data and the buttons reach the trainer over USB as well as over Bluetooth,
on mini 2 (DAL) and mini 3 (CODAL). They come from the trainer's own **ML data program**
(`microbit/calliope/`): the data collection program over Bluetooth plus a motion and
button stream over the USB serial port. The Blocks runtime is not touched. The standalone
trainer (outside Campus) stays exactly as it is.

Decisions already taken:

- ~~In Campus, the Blocks runtime replaces the data collection program completely, over
  USB and Bluetooth.~~ Changed in W1 by the owner: the data comes from an ML program of
  the trainer's own on both mini 2 and mini 3, with the same USB protocol on both; the
  Blocks runtime stays untouched. Reasons: the data collection program's source turned up
  in this repo (`microbit/`), which removed rejected option C's main objection; the DAL
  Blocks runtime has no room for a fast mode, and on the mini 2 it only answers the USB
  probe and sends no data; one program keeps BLE and USB identical in range and
  orientation.
- mini 2 and mini 3 ship together.
- Range 2 g and a 20 ms period, as the data collection program and the ML extension's
  program on the mini use (measured in W1).

## Current state

**Trainer** (Campus mode lives on the `feat-calliope` branch, PRs #1, #2, #4):

- `src/device/campusBluetooth.ts` (`CampusBluetoothConnection`) subscribes through
  Campus' GATT proxy (`src/device/campus-host.ts`) to the micro:bit services
  `e95d0753…` (accelerometer) and `e95d9882…` (buttons). They exist only in the data
  collection program, which the trainer flashes through Campus (`host.flash(hex, name)`,
  today `universal-hex.hex`).
- Since #4 it follows the connection widget (`src/campus-connection-hooks.ts` calls
  `follow()`): it takes over a Bluetooth link without a click when the data collection
  program runs. Over USB only, the live graph shows `campus-connect-needs-bluetooth`
  ("Daten brauchen Bluetooth", `src/components/LiveGraphPanel.tsx`).
- What the trainer expects: x/y/z as int16 in milli-g (divided by 1000 in
  `buffered-data-hooks.tsx`), every **20 ms** (`currentDataWindow.deviceSamplesPeriod`;
  1 s ≈ 50 samples, at least 44). The same period goes as `samples_period` into the
  generated MakeCode program, so the model on the mini runs at 50 Hz. Timestamps are set
  by the trainer on arrival.
- Since #10 the repo holds the ML data program (`microbit/calliope/`) and its hexes
  (`src/device/firmware/calliope-ml-data-dal.hex`, `calliope-ml-data-codal.hex`).
  Nothing loads them yet.

**Blocks runtime** (calliope-dev `firmware/codal/blocks-runtime`,
`firmware/dal/blocks-runtime-dal`): no longer part of this plan. For reference, its
MOTION channel (0x0102) runs at only ~50 ms over USB and ~57 ms over BLE with X and Z
negated and an 8 g range, which is why it was not used as it is.

**Campus** (calliope-campus) and **connection widget** (mini-connection-widget):

- `src/lib/blocks/calliopeRemoteHost.ts` maps Blocks UUIDs to USB channels and forwards
  notifies generically.
- The widget parses the Blocks serial framing (`src/blocks-frame.ts`,
  `BlocksFrameParser`) and detects the program on the mini (`src/program-type.ts`,
  `probeUsb`, `probeJlinkSerial`).
- The trainer bridge is `src/lib/kiTraining/kiTraining.ts`.

## Channel contract (as built in W1)

The original contract (a fast mode in the Blocks runtime on channel 0x0103) is replaced;
see the decision above. The full description is in `microbit/calliope/README.md` and
`microbit/calliope/source/MlUsb.h`; in short:

- **Bluetooth**: unchanged, the micro:bit accelerometer (`e95d0753…`) and button
  (`e95d9882…`) services of the data collection program, so `campusBluetooth.ts` keeps
  working as it is.
- **USB** (115200 baud): frames in the Blocks runtime's serial framing
  (`[0xFF, type, ch_hi, ch_lo, len, data[len], chk]`), so the widget's
  `BlocksFrameParser` parses them unchanged, on channels of their own in the `0x02xx`
  range:
  - `0x0200` ML_INFO, RES_READ (`0x01`): the reply to `FF 01 02 00` and once per second
    unprompted. `data[1] == 0x4D` ('M') identifies the program; it also carries the
    hardware (1 = mini 1/2, 2 = mini 3), protocol version (1), firmware build, sample
    period (20), range (2), resync count, worst lateness and the uptime in seconds.
  - `0x0203` MOTION, NOTIFY (`0x21`) every 20 ms: X, Y, Z as int16 little-endian in
    milli-g, not negated (the values the BLE service sends), then a uint8 sequence number.
  - `0x0210` BUTTON, NOTIFY (`0x21`) on each change: `[button (1 = A, 2 = B), state
(0 = released, 1 = pressed, 2 = long press)]`, as the BLE button service.
- The stream runs from boot. There is no on/off command, because the mini 2's DAL serial
  receive path goes deaf under SoftDevice load.
- Samples are paced against an absolute 20 ms deadline; the range is 2 g on both boards.
- A host must recognise the program by ML_INFO, must not count `0x02xx` frames towards the
  Blocks runtime's "N valid frames" fallback in the widget's `program-type.ts`, must relay
  0x0203 and 0x0210 unthrottled, and must reopen the serial port when nothing (not even the
  1 Hz ML_INFO) arrived for about 3 s: the mini 2's J-Link CDC link goes silent now and
  then while the mini keeps sending.
- Shipped hexes: `src/device/firmware/calliope-ml-data-dal.hex` (mini 1/2) and
  `src/device/firmware/calliope-ml-data-codal.hex` (mini 3). There is no universal hex of
  the two yet.

## Workstreams

- [x] **W1:** Firmware: the ML data program (landed in #10). Repository ml-trainer,
      `microbit/calliope/` (one C++ source, DAL and CODAL builds, `build.sh`,
      `tools/measure.py`). Instead of a fast mode in the Blocks runtime (see the decision
      above): the data collection program over Bluetooth, unchanged, plus the USB stream of
      the contract above. Measured on the devices on 2026-11-19/20 (full table in
      `microbit/calliope/README.md`):

  | board  | USB                                                        | BLE                                                                     | lost                           | values                                     |
  | ------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------ | ------------------------------------------ |
  | mini 3 | 50.0/s, also with BLE at once                              | 50.2/s                                                                  | 0                              | match the old data collection program, 2 g |
  | mini 2 | 49.2–49.5/s, also with BLE at once and with button presses | as the old program (the DAL notifies on every sensor update, in bursts) | 0 (USB and BLE at once, 140 s) | match the old data collection program, 2 g |

  The mini 2's 49.4/s has no sequence gaps: the DAL clock runs about 1 % slow against the
  PC. Two findings that matter for hosts: the DAL build sends serial frames byte by byte,
  because microbit-dal's interrupt-driven send killed the stream when two frames
  overlapped; and in a 25-minute soak the mini 2's USB link went silent on the PC side
  twice (the mini kept running), and reopening the port brought it back at once.

- [x] **W2:** Connection widget and Campus: recognise the ML data program over USB and
      relay its stream. Repositories mini-connection-widget and calliope-campus. The widget's
      `program-type.ts` recognises the program by an ML_INFO frame (`0x0200`,
      `data[1] == 0x4D`) and does not count `0x02xx` frames towards the Blocks runtime's
      valid-frame fallback (`probeUsb`, `probeJlinkSerial`), or it reports the program as the
      Blocks runtime. In `src/lib/kiTraining/kiTraining.ts`, the `status` message to the
      trainer gains `program`: the program the widget detected on the mini, `"ml-data"` for
      the ML data program (recognised over USB by ML_INFO), `"blocks"`, `"unknown"` for any
      other, `null` while it has not looked (as fixed by W3 in the protocol comment of the
      trainer's `src/device/campus-host.ts`). The trainer subscribes to the channels through
      the existing GATT proxy as `0b500203-607f-4151-9091-7d008d6ffc5c` and
      `0b500210-607f-…` (Campus already maps `0b50XXXX` to channel 0xXXXX), and Campus relays 0x0203 MOTION
      and 0x0210 BUTTON frames to the trainer unthrottled at 50 Hz (nothing in
      `calliopeRemoteHost.ts` or the widget's codec may batch or drop them). When no frame
      arrived over USB for about 3 s, the port is closed and reopened (mini 2 J-Link stalls,
      see W1). Flashing keeps the existing `flash` request with a hex from the trainer. The
      protocol comment in the trainer's `campus-host.ts` is updated in W3. Tests in
      `kiTraining.test.ts`. Lands on its own: without a trainer asking for it, nothing
      changes for users.
- [x] **W3:** Trainer: `CampusConnection` against a simulated ML data program. Repository
      ml-trainer. `src/device/campusConnection.ts` (`CampusConnection`) reads motion data
      over whichever link Campus holds: Bluetooth when Campus has it (the micro:bit
      accelerometer and button services, as `campusBluetooth.ts`), otherwise USB once Campus
      reports `program: "ml-data"` (0x0203 MOTION and 0x0210 BUTTON through the GATT proxy).
      It moves between the two when Campus switches links. `connect()` asks Campus for a
      Bluetooth link only when it holds none, and flashes the ML data program
      (`calliope-ml-data-dal.hex` for V1, `calliope-ml-data-codal.hex` for V2, a universal
      hex of both built at runtime when the board is not known) when it does not run;
      `follow()` never flashes. `CampusStatus` gained `program`; the protocol comment in
      `campus-host.ts` describes it and the USB channels. `src/device/campusSimulation.ts`
      simulates Campus and the ML data program (MOTION every 20 ms, BUTTON frames, ML_INFO)
      for the unit tests (`campusConnection.test.ts`) and for running the trainer without
      hardware: `?simulate=campus` (options `simLink`, `simProgram`, `simBoard`) runs Campus
      mode against it with a small control panel. Campus mode itself still uses
      `CampusBluetoothConnection`; only the simulation uses `CampusConnection`
      (`getCampusDevice()` and `hasDataLink()` in `src/campus-connection-hooks.ts`).
- [x] **W4:** Trainer: switch Campus mode to the ML data program. Repository ml-trainer.
      Campus mode uses `CampusConnection` (`getCampusDevice()` and `hasDataLink()` in
      `src/campus-connection-hooks.ts`); `campusBluetooth.ts` is gone. The trainer follows
      the widget over USB (once Campus reports `program: "ml-data"`) or Bluetooth, its
      "Connect" flashes the ML data program through Campus instead of `universal-hex.hex`,
      and it still never flashes unprompted. The live graph's "movement data comes via
      Bluetooth" hint (`campus-connect-needs-bluetooth`) and its strings are gone; a mini on
      USB without the ML data program gets the same "Connect transfers it" hint as one on
      Bluetooth, under the kept `campus-microbit-usb-connected` title. `DataWindow` stays at
      20 ms; the standalone trainer is unchanged. Tested by the owner on mini 2 and mini 3,
      over USB and Bluetooth, recording, training, live testing and a model on the mini
      through MakeCode (2026-11-21).

      The end-to-end test found a defect outside the trainer: the microbit-connection patch
      that the widget and Campus each carry decoded DAPLink serial reads with
      `TextDecoder("iso-8859-1")`, which the Encoding Standard maps to windows-1252. Bytes
      0x80-0x9F came back changed, so every frame holding one failed its checksum: on a
      mini 3 over USB about a fifth of the samples and 0.6 s every 5 s were lost (39 instead
      of 50 per second). Both patches now decode one code unit per byte
      (`String.fromCharCode`); measured afterwards: 50.0 samples/s, none lost in 60 s.
      Blocks frames read over DAPLink serial had the same flaw.

## Order and dependencies

```
W1 firmware (landed) ─────┐
W2 widget + Campus ───────┼──> W4 trainer switch-over
W3 trainer (simulated) ───┘
```

W2 and W3 can run in parallel against the contract above. W4 waits for both.

## Risks

- ~~**50 Hz over BLE on the mini 2**~~: settled in W1. USB holds 49.4/s next to BLE and
  button presses with nothing lost; BLE behaves as the old data collection program.
- **mini 2 USB stalls on the PC side** (J-Link CDC): about twice in 25 minutes. The host
  must reopen the port after about 3 s of silence (W2); samples in that window are lost.
- **Range and orientation**: recordings must match what the ML extension's program on the
  mini measures, otherwise models trained in Campus recognise worse on the device. W1
  measured that the USB stream, BLE and the old data collection program agree (2 g, not
  negated); W4 checks it end to end.
- **Timestamps on arrival**: USB and postMessage add jitter. The trainer already stamps
  on arrival with the data collection program over BLE, so no change is planned; W4
  watches the sample count per second (at least 44).

## Rejected

- **A: fast motion mode in the Blocks runtime** (the original plan). Dropped in W1: the
  DAL runtime has no room for it and on the mini 2 sends no data over USB; the ML data
  program reaches 50 Hz on both boards without touching the runtime.
- **B: runtime unchanged, record at ~20 Hz.** Too few samples and an unsteady rate;
  projects at 50 ms would not match the existing 20 ms ones.
- ~~**C: data collection program additionally over serial.**~~ Rejected at first (source
  not found, a second USB codec). W1 found the source in `microbit/` and used the Blocks
  serial framing, so this became the chosen path.
- **Radio bridge / the trainer's `local-sensors` hex.** micro:bit V2 only, with a protocol
  the widget does not speak.
