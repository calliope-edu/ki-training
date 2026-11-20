/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * A simulated Campus with a simulated mini, for unit tests and for running
 * the trainer in Campus mode without Campus or hardware (`?simulate=campus`).
 *
 * SimulatedMlDataProgram produces what the ML data program
 * (microbit/calliope) sends: a MOTION frame (0x0203) every 20 ms, a BUTTON
 * frame (0x0210) on each button change, ML_INFO (0x0200) on request, and the
 * same values on the Bluetooth accelerometer and button services.
 *
 * SimulatedCampusHost plays Campus (see campus-host.ts): it reports the links
 * and the detected program in its status, answers connect and flash, and
 * relays the program's data through its GATT proxy the way Campus does:
 * over Bluetooth when that link is up, otherwise over USB.
 */
import { BoardVersion } from "@microbit/microbit-connection";
import {
  CampusHost,
  CampusLinkStatus,
  CampusProgram,
  CampusStatus,
  installCampusHost,
} from "./campus-host";
import {
  ACCELEROMETER_DATA,
  ACCELEROMETER_PERIOD,
  ACCELEROMETER_SERVICE,
  BUTTON_A,
  BUTTON_B,
  BUTTON_SERVICE,
  ML_BUTTON_CHANNEL,
  ML_DATA_PROGRAM_NAME,
  ML_INFO_CHANNEL,
  ML_MOTION_CHANNEL,
} from "./campusConnection";

export const ML_SAMPLE_PERIOD_MS = 20;

export type SimulatedMotion = "still" | "shake" | "circle";

export type SimulatedButton = "A" | "B";

/** Button states as the BLE button service and the BUTTON frame carry them. */
export enum SimulatedButtonState {
  Released = 0,
  Pressed = 1,
  LongPress = 2,
}

type FrameListener = (channel: number, data: Uint8Array) => void;

/** milli-g for the given motion at `t` ms since the program started. */
export const simulatedAcceleration = (
  motion: SimulatedMotion,
  t: number
): [number, number, number] => {
  // A little sensor noise on every motion, as on the mini.
  const noise = () => Math.round((Math.random() - 0.5) * 16);
  switch (motion) {
    case "still":
      return [-80 + noise(), 40 + noise(), -990 + noise()];
    case "shake": {
      const phase = (t / 1000) * 2 * Math.PI * 4;
      return [
        Math.round(1400 * Math.sin(phase)) + noise(),
        Math.round(300 * Math.sin(phase * 0.5)) + noise(),
        -990 + Math.round(400 * Math.cos(phase)) + noise(),
      ];
    }
    case "circle": {
      const phase = (t / 1000) * 2 * Math.PI * 0.8;
      return [
        Math.round(700 * Math.cos(phase)) + noise(),
        Math.round(700 * Math.sin(phase)) + noise(),
        -700 + noise(),
      ];
    }
  }
};

const int16le = (out: Uint8Array, offset: number, value: number) => {
  const v = Math.max(-32768, Math.min(32767, Math.round(value)));
  out[offset] = v & 0xff;
  out[offset + 1] = (v >> 8) & 0xff;
};

/** The ML data program on a simulated mini. */
export class SimulatedMlDataProgram {
  motion: SimulatedMotion = "still";
  /** The last sample, as the Bluetooth accelerometer service would send it. */
  acceleration: [number, number, number] = [0, 0, -1000];
  private seq = 0;
  private startedAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private listeners = new Set<FrameListener>();
  private longPressTimers = new Map<
    SimulatedButton,
    ReturnType<typeof setTimeout>
  >();

  constructor(private hardware: BoardVersion = "V2") {}

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Boots the program: MOTION every 20 ms from now on. */
  start() {
    if (this.timer) {
      return;
    }
    this.startedAt = Date.now();
    this.seq = 0;
    this.timer = setInterval(() => this.sample(), ML_SAMPLE_PERIOD_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.longPressTimers.forEach((timer) => clearTimeout(timer));
    this.longPressTimers.clear();
  }

  /** Called with every frame the program sends over USB. */
  addFrameListener(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private send(channel: number, data: Uint8Array) {
    this.listeners.forEach((listener) => listener(channel, data));
  }

  private sample() {
    const [x, y, z] = simulatedAcceleration(
      this.motion,
      Date.now() - this.startedAt
    );
    this.acceleration = [x, y, z];
    const data = new Uint8Array(7);
    int16le(data, 0, x);
    int16le(data, 2, y);
    int16le(data, 4, z);
    data[6] = this.seq;
    this.seq = (this.seq + 1) & 0xff;
    this.send(ML_MOTION_CHANNEL, data);
  }

  /** ML_INFO: hardware, 'M', protocol, build, period, range, resyncs, lateness, uptime. */
  info(): Uint8Array {
    const uptime = this.running
      ? Math.floor((Date.now() - this.startedAt) / 1000)
      : 0;
    return Uint8Array.of(
      this.hardware === "V1" ? 1 : 2,
      0x4d,
      1,
      1,
      ML_SAMPLE_PERIOD_MS,
      2,
      0,
      0,
      uptime & 0xff,
      (uptime >> 8) & 0xff
    );
  }

  /** A button change, as a BUTTON frame. */
  setButton(button: SimulatedButton, state: SimulatedButtonState) {
    if (!this.running) {
      return;
    }
    this.send(ML_BUTTON_CHANNEL, Uint8Array.of(button === "A" ? 1 : 2, state));
  }

  /** Presses and releases a button; held long enough, it reports a long press in between, as the mini does. */
  press(button: SimulatedButton, holdMs = 100) {
    this.setButton(button, SimulatedButtonState.Pressed);
    clearTimeout(this.longPressTimers.get(button));
    if (holdMs >= 1500) {
      setTimeout(
        () => this.setButton(button, SimulatedButtonState.LongPress),
        1500
      );
    }
    this.longPressTimers.set(
      button,
      setTimeout(() => {
        this.longPressTimers.delete(button);
        this.setButton(button, SimulatedButtonState.Released);
      }, holdMs)
    );
  }
}

const charKey = (serviceId: string, characteristicId: string) =>
  `${serviceId.toLowerCase()}|${characteristicId.toLowerCase()}`;

/** The serial channel of a Blocks-style UUID, as Campus maps it (`0b50XXXX-…`). */
const usbChannel = (characteristicId: string): number | undefined => {
  const match = /^0b50([0-9a-f]{4})-607f-4151-9091-7d008d6ffc5c$/.exec(
    characteristicId.toLowerCase()
  );
  return match ? parseInt(match[1], 16) : undefined;
};

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export interface SimulatedCampusOptions {
  usb?: boolean;
  ble?: boolean;
  /** What runs on the mini at the start. */
  program?: CampusProgram | null;
  boardVersion?: BoardVersion;
  /** How long a flash takes. */
  flashMs?: number;
  /** How long Campus takes to connect over Bluetooth, and to recognise a program over USB. */
  linkMs?: number;
}

type NotifyListener = (data: DataView) => void;

/** Campus with its connection widget and a simulated mini behind it. */
export class SimulatedCampusHost extends CampusHost {
  readonly program: SimulatedMlDataProgram;
  private usb: boolean;
  private ble: boolean;
  private runningProgram: CampusProgram | null;
  private boardVersion: BoardVersion;
  private flashing = false;
  // After a flash the widget looks at the program again before it reports it.
  private recognising = false;
  private flashMs: number;
  private linkMs: number;
  private listeners = new Map<string, NotifyListener>();

  constructor(options: SimulatedCampusOptions = {}) {
    super();
    this.usb = options.usb ?? true;
    this.ble = options.ble ?? false;
    this.runningProgram =
      options.program === undefined ? "ml-data" : options.program;
    this.boardVersion = options.boardVersion ?? "V2";
    this.flashMs = options.flashMs ?? 3000;
    this.linkMs = options.linkMs ?? 500;
    this.program = new SimulatedMlDataProgram(this.boardVersion);
    this.program.addFrameListener(this.onFrame);
    this.update();
  }

  private bleLink(): CampusLinkStatus {
    return this.ble ? "connected" : "disconnected";
  }

  private update() {
    if (this.runningProgram === "ml-data" && (this.usb || this.ble)) {
      this.program.start();
    } else {
      this.program.stop();
    }
    const linked = this.usb || this.ble;
    const status: CampusStatus = {
      ble: this.bleLink(),
      usb: this.usb ? "connected" : "disconnected",
      boardVersion: linked ? this.boardVersion : null,
      flashing: this.flashing,
      // The widget recognises the ML data program only over USB; over
      // Bluetooth alone it tells nothing apart from the Blocks runtime.
      program:
        this.flashing || this.recognising || !linked
          ? null
          : this.runningProgram === "ml-data" && !this.usb
          ? "unknown"
          : this.runningProgram,
    };
    this.setStatus(status);
  }

  // Campus routes the GATT proxy over Bluetooth whenever it holds that link.
  private routedOver(): "ble" | "usb" | null {
    return this.ble ? "ble" : this.usb ? "usb" : null;
  }

  private onFrame = (channel: number, data: Uint8Array) => {
    if (this.flashing) {
      return;
    }
    const route = this.routedOver();
    if (route === "usb") {
      for (const [key, listener] of this.listeners) {
        if (usbChannel(key.split("|")[1]) === channel) {
          listener(view(data));
        }
      }
      return;
    }
    if (route !== "ble") {
      return;
    }
    if (channel === ML_MOTION_CHANNEL) {
      this.listeners.get(charKey(ACCELEROMETER_SERVICE, ACCELEROMETER_DATA))?.(
        view(data.slice(0, 6))
      );
    } else if (channel === ML_BUTTON_CHANNEL) {
      const characteristic = data[0] === 1 ? BUTTON_A : BUTTON_B;
      this.listeners.get(charKey(BUTTON_SERVICE, characteristic))?.(
        view(data.slice(1, 2))
      );
    }
  };

  /** Plugs the mini in or out (USB), or connects it in the widget over Bluetooth or ends that link. */
  setLinks(links: { usb?: boolean; ble?: boolean }) {
    this.usb = links.usb ?? this.usb;
    this.ble = links.ble ?? this.ble;
    this.update();
  }

  /** Puts another program onto the mini, as if the user had flashed it elsewhere. */
  setProgram(program: CampusProgram | null) {
    this.runningProgram = program;
    this.update();
  }

  get links(): { usb: boolean; ble: boolean } {
    return { usb: this.usb, ble: this.ble };
  }

  get currentProgram(): CampusProgram | null {
    return this.runningProgram;
  }

  connect(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) =>
      setTimeout(() => {
        this.ble = true;
        this.update();
        resolve({ ok: true });
      }, this.linkMs)
    );
  }

  flash(_hex: string, name: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.usb && !this.ble) {
      return Promise.resolve({ ok: false, error: "not connected" });
    }
    this.flashing = true;
    this.runningProgram = null;
    this.update();
    return new Promise((resolve) =>
      setTimeout(() => {
        this.flashing = false;
        this.recognising = true;
        this.runningProgram =
          name === ML_DATA_PROGRAM_NAME ? "ml-data" : "unknown";
        this.update();
        resolve({ ok: true });
        setTimeout(() => {
          this.recognising = false;
          this.update();
        }, this.linkMs);
      }, this.flashMs)
    );
  }

  read(serviceId: string, characteristicId: string): Promise<DataView> {
    const route = this.routedOver();
    const runs = this.program.running && !this.flashing;
    let bytes = new Uint8Array(0);
    if (route === "ble" && runs) {
      if (
        charKey(serviceId, characteristicId) ===
        charKey(ACCELEROMETER_SERVICE, ACCELEROMETER_PERIOD)
      ) {
        bytes = Uint8Array.of(ML_SAMPLE_PERIOD_MS, 0);
      } else if (
        charKey(serviceId, characteristicId) ===
        charKey(ACCELEROMETER_SERVICE, ACCELEROMETER_DATA)
      ) {
        bytes = new Uint8Array(6);
        const [x, y, z] = this.program.acceleration;
        int16le(bytes, 0, x);
        int16le(bytes, 2, y);
        int16le(bytes, 4, z);
      }
    } else if (
      route === "usb" &&
      runs &&
      usbChannel(characteristicId) === ML_INFO_CHANNEL
    ) {
      bytes = this.program.info();
    }
    return Promise.resolve(view(bytes));
  }

  subscribe(
    serviceId: string,
    characteristicId: string,
    listener: NotifyListener
  ) {
    this.listeners.set(charKey(serviceId, characteristicId), listener);
  }

  unsubscribe(serviceId: string, characteristicId: string) {
    this.listeners.delete(charKey(serviceId, characteristicId));
  }

  /** Subscriptions the trainer holds, for tests. */
  get subscriptions(): string[] {
    return [...this.listeners.keys()];
  }
}

let simulation: SimulatedCampusHost | undefined;

/**
 * Makes a simulated Campus the page's Campus link (`?simulate=campus`). It
 * starts with the mini on USB running the ML data program; `simLink`
 * (usb, ble, both, none), `simProgram` (ml-data, blocks, unknown, none) and
 * `simBoard` (V1, V2) change that. Exposed as `window.campusSimulation` for
 * tests and the console.
 */
export const startCampusSimulation = (): SimulatedCampusHost => {
  if (!simulation) {
    const params = new URLSearchParams(window.location.search);
    const link = params.get("simLink") ?? "usb";
    const program = params.get("simProgram") ?? "ml-data";
    simulation = new SimulatedCampusHost({
      usb: link === "usb" || link === "both",
      ble: link === "ble" || link === "both",
      program:
        program === "ml-data" || program === "blocks" || program === "unknown"
          ? program
          : null,
      boardVersion: params.get("simBoard") === "V1" ? "V1" : "V2",
    });
    installCampusHost(simulation);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (window as any).campusSimulation = simulation;
  }
  return simulation;
};

/** The simulated Campus, once started. */
export const getCampusSimulation = (): SimulatedCampusHost | undefined =>
  simulation;
