# Plan: Campus KI-Training gets motion data over USB too

## Goal

In Campus mode (the trainer embedded in Calliope Campus with `?controller=2`), the
accelerometer data and the buttons come from the **Blocks runtime**, over USB and over
Bluetooth alike, on mini 2 (DAL) and mini 3 (CODAL). Campus no longer needs the data
collection program (`universal-hex.hex`). The standalone trainer (outside Campus) stays
exactly as it is.

Decisions already taken:

- In Campus, the Blocks runtime replaces the data collection program completely, over USB
  and Bluetooth.
- mini 2 and mini 3 ship together.
- Range and the exact shape of the on/off command are decided by the firmware worker at
  the device (see W1).

## Current state

**Trainer** (Campus mode lives on the `feat-calliope` branch, PRs #1, #2, #4):

- `src/device/campusBluetooth.ts` (`CampusBluetoothConnection`) subscribes through
  Campus' GATT proxy (`src/device/campus-host.ts`) to the micro:bit services
  `e95d0753…` (accelerometer) and `e95d9882…` (buttons). They exist only in the data
  collection program, which the trainer flashes through Campus (`host.flash(hex, name)`).
- Since #4 it follows the connection widget (`src/campus-connection-hooks.ts` calls
  `follow()`): it takes over a Bluetooth link without a click when the data collection
  program runs. Over USB only, the live graph shows `campus-connect-needs-bluetooth`
  ("Daten brauchen Bluetooth", `src/components/LiveGraphPanel.tsx`).
- What the trainer expects: x/y/z as int16 in milli-g (divided by 1000 in
  `buffered-data-hooks.tsx`), every **20 ms** (`currentDataWindow.deviceSamplesPeriod`;
  1 s ≈ 50 samples, at least 44). The same period goes as `samples_period` into the
  generated MakeCode program, so the model on the mini runs at 50 Hz. Timestamps are set
  by the trainer on arrival.

**Blocks runtime** (calliope-dev `firmware/codal/blocks-runtime`,
`firmware/dal/blocks-runtime-dal`, same structure):

- MOTION (0x0102, 18 bytes) carries pitch, roll, X/Y/Z in milli-g (bytes 4–9), compass etc.
- Rate only ~50 ms over USB (STATE and MOTION alternate, `fiber_sleep(25)`) and ~57 ms
  over BLE (notify on every 3rd update).
- X and Z are negated; range is `setRange(8)`.
- Buttons arrive as events on SENSOR_EVENT (0x0110).
- USB runs at 115200 baud.

**Campus** (calliope-campus):

- `src/lib/blocks/calliopeRemoteHost.ts` maps Blocks UUIDs (`0b50xxxx-607f-4151-9091-7d008d6ffc5c`)
  to USB channels via `characteristicToChannel` and forwards notifies generically. Some
  per-channel lists exist (log labels in `BLE_CH_NAME`, the STATE/MOTION read cache).
- `fetchBlocksRuntimeHex('codal'|'dal')` and `blocks-version.json`
  (`src/lib/snap/snapEditor.ts`) deliver the runtime hex and its version from the Blocks
  editor's static folder.
- The widget detects the runtime version on the mini (`src/lib/blocks/BlocksBannerSource.svelte`).
- The trainer bridge is `src/lib/kiTraining/kiTraining.ts`.

## Channel contract (fixed up front)

Fixed here so the trainer (W3) can start against a simulated runtime before the firmware
lands. W1 may refine the command bytes; it must then update this section.

- **Fast motion mode**, switched on and off by a command on COMMAND (0x0100). Proposed
  shape: one command byte "motion fast" plus a flag byte (1 = on, 0 = off). The runtime
  turns the mode off by itself on disconnect and reset.
- **New channel 0x0103 `MOTION_FAST`**, 6 bytes: X, Y, Z as int16 little-endian, milli-g.
  BLE: notify on `0b500103-607f-4151-9091-7d008d6ffc5c`. USB: a notify frame on channel
  0x0103.
- Every **20 ms**, paced by the accelerometer period, not by `fiber_sleep`.
- Axes in **micro:bit orientation as the data collection program sends them**, i.e. not
  negated. No compass, pitch or roll (they cost CPU time on the mini 2).
- While on: the same range as the data collection program and the ML extension's program
  on the mini use (expected 2 g, to be measured). Back to 8 g when switched off.
- Buttons stay on SENSOR_EVENT (0x0110), unchanged.
- The runtime version goes up; the trainer treats every older version as "no fast mode".

## Workstreams

- [ ] **W1:** Firmware: fast motion mode in the Blocks runtime (CODAL + DAL). Repository
  calliope-dev (`firmware/codal/blocks-runtime`, `firmware/dal/blocks-runtime-dal`; not
  a repository on the Obeya canvas yet, so this card has to be placed by hand). Implement
  the channel contract above in both runtimes: the COMMAND handler, channel 0x0103 over
  BLE (new characteristic in the Blocks service) and over USB (`BlocksSerial`), 20 ms
  pacing from the accelerometer period, axes not negated, range switch on/off. Decide
  whether the USB STATE/MOTION broadcaster pauses while the mode is on (measure first;
  115200 baud has room for 50 frames/s, the risk is the serial loop's timing). Compare the
  values at rest and on each axis against the data collection program on the same mini,
  and pin the range to what the data collection program and the ML extension use. Bump
  the runtime version, build with the `build-calliope-firmware` skill and ship the hexes
  with `blocks-version.json` to the Blocks editor's static folder. Measure the actual rate
  over USB and BLE on mini 2 and mini 3 (main risk: 50 Hz over BLE on the mini 2 next to
  events) and write the numbers into this doc. Done when both runtimes deliver 0x0103 at
  ≈50 Hz on both transports and both boards, and the deployed `blocks-version.json` names
  the new version.
- [ ] **W2:** Campus: flash the Blocks runtime for the trainer and report its version.
  Repository calliope-campus. In `src/lib/kiTraining/kiTraining.ts`, a `flash` request
  with name `blocks-runtime` and no hex makes Campus fetch the runtime with
  `fetchBlocksRuntimeHex`, choosing CODAL or DAL by board version as for Snap!. The
  `status` message to the trainer gains the runtime version detected on the mini (as
  `BlocksBannerSource.svelte` shows it; `null` when none runs). Check that 0x0103 notifies
  pass through unthrottled at 50 Hz on both paths: the USB codec of the connection widget
  (mini-connection-widget) must accept frames on an unknown or new channel, and nothing in
  `calliopeRemoteHost.ts` may batch or drop them; add 0x0103 to `BLE_CH_NAME`. Update the
  protocol comment in the trainer's `campus-host.ts` in W3. Tests in `kiTraining.test.ts`.
  Lands on its own: without a trainer asking for it, nothing changes for users.
- [ ] **W3:** Trainer: `CampusConnection` against a simulated runtime. Repository
  ml-trainer, on top of `feat-calliope`. New `src/device/campusConnection.ts` that
  implements what `CampusBluetoothConnection` implements, but bound to no transport:
  connected when Campus reports USB or BLE connected and a runtime with the fast mode;
  then it switches the mode on, subscribes to 0x0103 and turns SENSOR_EVENT button events
  into `ButtonEvent`s. `connect()` asks Campus to flash `blocks-runtime` when none or a
  too old one runs; `follow()` never flashes. Mode off on `dispose()`. Extend
  `CampusHost`/`CampusStatus` with the runtime version and the `flash` request without
  hex, and update the protocol comment. A simulated runtime (like `mockBluetooth.ts`)
  emits 0x0103 every 20 ms and button events, for unit tests and for running the trainer
  without hardware. Not wired into Campus mode yet, so it lands without changing behaviour.
- [ ] **W4:** Trainer: switch Campus mode to the Blocks runtime. Repository ml-trainer.
  Needs W1 deployed, W2 landed and W3. `campus-connection-hooks.ts` and everything that
  calls `getCampusBluetooth()` use `CampusConnection`. It follows the widget over USB or
  BLE, offers "Connect" (which flashes the runtime through Campus) only when no runtime or
  a too old one runs, and as since #4 never flashes unprompted. It switches the mode off
  on disconnect and on the switch to MakeCode (`setView("makecode")`). The data collection
  program and the micro:bit UUIDs go from the Campus path; `campusBluetooth.ts` is
  removed. The `campus-microbit-usb-connected` / `campus-connect-needs-bluetooth` hint in
  `LiveGraphPanel.tsx` goes, with its strings in `lang/ui.*.json` (then
  `npm run i18n:compile`). `DataWindow` stays at 20 ms, so existing projects keep
  working. The standalone trainer is untouched. Done when the owner has recorded, trained
  and tested live on mini 2 and mini 3, each over USB and over BLE, and a model put on the
  mini through MakeCode recognises the actions as well as one recorded with the data
  collection program.

## Order and dependencies

```
W1 firmware ──────────────┐
W2 Campus  ───────────────┼──> W4 trainer switch-over
W3 trainer (simulated) ───┘
```

W1, W2 and W3 can run in parallel; W3 depends only on the channel contract above. W4
waits for all three. If W1 has to change the contract, it updates this doc and W3
follows.

## Risks

- **50 Hz over BLE on the mini 2** next to other events: the main risk. If it does not
  hold, the fallback is to pack two samples per notify (12 bytes every 40 ms) and keep the
  20 ms sample period; the trainer then unpacks them. Decided in W1 by measurement.
- **Range and orientation**: recordings must match what the ML extension's program on the
  mini measures, otherwise models trained in Campus recognise worse on the device. W1
  checks this against the data collection program; W4 checks it end to end.
- **Timestamps on arrival**: USB and postMessage add jitter. The trainer already stamps
  on arrival with the data collection program over BLE, so no change is planned; W4
  watches the sample count per second (at least 44).

## Rejected

- **B: runtime unchanged, record at ~20 Hz.** Too few samples and an unsteady rate;
  projects at 50 ms would not match the existing 20 ms ones.
- **C: data collection program additionally over serial.** Its source is not here, Campus
  would need a second USB codec, and two runtimes would remain.
- **Radio bridge / the trainer's `local-sensors` hex.** micro:bit V2 only, with a protocol
  the widget does not speak.
