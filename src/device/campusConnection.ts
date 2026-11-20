/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * The data collection mini in Campus mode (see campus-host.ts), over
 * whichever link Campus holds:
 *
 * - Bluetooth: the micro:bit accelerometer and button services of the ML
 *   data program, the same the trainer's data collection program offers, so
 *   a mini running either is picked up.
 * - USB: the ML data program (microbit/calliope) streams motion every 20 ms
 *   and button changes on the serial port; Campus recognises it (status
 *   `program: "ml-data"`) and relays its frames through the GATT proxy.
 *
 * connect() puts the ML data program onto the mini through Campus when it
 * does not run; follow() only picks up a link Campus already holds and never
 * flashes, so a program the user put onto the mini stays.
 *
 * In Campus mode the ML data program takes the place of the data collection
 * program (universal-hex.hex) the standalone trainer flashes. The simulated
 * Campus (`?simulate=campus`, campusSimulation.ts) runs this same class.
 */
import {
  AccelerometerData,
  AccelerometerDataEvent,
  BoardVersion,
  ButtonEvent,
  ButtonEventType,
  ButtonState,
  ConnectionStatus,
  ConnectionStatusEvent,
  DeviceConnectionEventMap,
  LedMatrix,
  MicrobitWebBluetoothConnection,
  ServiceConnectionEventMap,
  TypedEventTarget,
} from "@microbit/microbit-connection";
import {
  createUniversalHex,
  microbitBoardId,
} from "@microbit/microbit-universal-hex";
import { CampusLink, CampusStatus, getCampusHost } from "./campus-host";
import hexMlDataCodal from "./firmware/calliope-ml-data-codal.hex";
import hexMlDataDal from "./firmware/calliope-ml-data-dal.hex";

// Bluetooth: the micro:bit profile of the data collection program.
export const ACCELEROMETER_SERVICE = "e95d0753-251d-470a-a062-fa1922dfa9a8";
export const ACCELEROMETER_DATA = "e95dca4b-251d-470a-a062-fa1922dfa9a8";
export const ACCELEROMETER_PERIOD = "e95dfb24-251d-470a-a062-fa1922dfa9a8";
export const BUTTON_SERVICE = "e95d9882-251d-470a-a062-fa1922dfa9a8";
export const BUTTON_A = "e95dda90-251d-470a-a062-fa1922dfa9a8";
export const BUTTON_B = "e95dda91-251d-470a-a062-fa1922dfa9a8";

// USB: the ML data program's serial channels (microbit/calliope/source/MlUsb.h).
export const ML_INFO_CHANNEL = 0x0200;
export const ML_MOTION_CHANNEL = 0x0203;
export const ML_BUTTON_CHANNEL = 0x0210;

/** A serial channel as the GATT proxy addresses it: Campus maps `0b50XXXX-…` to channel 0xXXXX. */
export const mlChannelUuid = (channel: number): string =>
  `0b50${channel.toString(16).padStart(4, "0")}-607f-4151-9091-7d008d6ffc5c`;

// Over USB Campus only echoes the service back with each notify.
export const ML_SERVICE = mlChannelUuid(ML_INFO_CHANNEL);
export const ML_MOTION = mlChannelUuid(ML_MOTION_CHANNEL);
export const ML_BUTTON = mlChannelUuid(ML_BUTTON_CHANNEL);

/** The name the trainer flashes the ML data program under. */
export const ML_DATA_PROGRAM_NAME = "ml-data-program";

/** How long the mini may take to come back after a flash. */
export const RECONNECT_AFTER_FLASH_MS = 45_000;

export type CampusTransport = "ble" | "usb";

/**
 * The link the trainer reads motion data over, or null when there is none
 * yet. Campus routes the GATT proxy over Bluetooth whenever it holds that
 * link, so USB counts only while Bluetooth is down, and only once Campus has
 * recognised the ML data program there. Over Bluetooth the program is checked
 * by reading the accelerometer service (see runsProgram).
 */
export const campusDataTransport = (
  status: CampusStatus
): CampusTransport | null => {
  if (status.flashing) {
    return null;
  }
  if (status.ble === "connected") {
    return "ble";
  }
  if (status.usb === "connected" && status.program === "ml-data") {
    return "usb";
  }
  return null;
};

export type MlDataHexFile = "dal" | "codal";

const fetchHex = async (file: MlDataHexFile): Promise<string> => {
  const response = await fetch(file === "dal" ? hexMlDataDal : hexMlDataCodal);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${response.status}`);
  }
  return response.text();
};

/**
 * The ML data program for the board: the DAL build for a mini 1/2 (V1), the
 * CODAL build for a mini 3 (V2), and both in one universal hex when Campus
 * does not know the board.
 */
export const mlDataProgramHex = async (
  boardVersion: BoardVersion | null,
  loadHex: (file: MlDataHexFile) => Promise<string> = fetchHex
): Promise<string> => {
  if (boardVersion === "V1") {
    return loadHex("dal");
  }
  if (boardVersion === "V2") {
    return loadHex("codal");
  }
  const [dal, codal] = await Promise.all([loadHex("dal"), loadHex("codal")]);
  return createUniversalHex([
    { hex: dal, boardId: microbitBoardId.V1 },
    { hex: codal, boardId: microbitBoardId.V2 },
  ]);
};

// The library exports its event classes as types only; these build the same
// shape (an Event with the payload on it).
const accelerometerDataEvent = (data: AccelerometerData) =>
  Object.assign(new Event("accelerometerdatachanged"), {
    data,
  }) as AccelerometerDataEvent;

const buttonEvent = (type: ButtonEventType, state: ButtonState) =>
  Object.assign(new Event(type), { state }) as ButtonEvent;

// 0 = not pressed, 1 = pressed, 2 = long press. The library exports
// ButtonState as a type only.
const buttonState = (value: number): ButtonState | undefined =>
  value >= 0 && value <= 2 ? (value as ButtonState) : undefined;

export interface CampusConnectionOptions {
  /** Loads a build of the ML data program (fetched from the trainer's assets by default). */
  loadHex?: (file: MlDataHexFile) => Promise<string>;
  reconnectAfterFlashMs?: number;
}

export class CampusConnection
  extends TypedEventTarget<DeviceConnectionEventMap & ServiceConnectionEventMap>
  implements MicrobitWebBluetoothConnection
{
  status: ConnectionStatus = ConnectionStatus.NO_AUTHORIZED_DEVICE;
  /** The link data streams over, null when not streaming. */
  streamingOver: CampusTransport | null = null;
  // Bumped whenever streaming starts or stops, so a check still running for
  // an earlier state does not act on the current one.
  private generation = 0;
  private busy = false;
  private loadHex: (file: MlDataHexFile) => Promise<string>;
  private reconnectAfterFlashMs: number;

  constructor(private host: CampusLink, options: CampusConnectionOptions = {}) {
    super();
    this.loadHex = options.loadHex ?? fetchHex;
    this.reconnectAfterFlashMs =
      options.reconnectAfterFlashMs ?? RECONNECT_AFTER_FLASH_MS;
    host.addStatusListener(this.onCampusStatus);
  }

  private setStatus(status: ConnectionStatus) {
    if (status === this.status) {
      return;
    }
    this.status = status;
    this.dispatchTypedEvent("status", new ConnectionStatusEvent(status));
  }

  // Follows Campus' links while streaming: moves to the other link when
  // Campus switches (Bluetooth came up next to USB, or went and USB stays),
  // and reports a link Campus lost like a dropped Bluetooth connection, so
  // the trainer offers to reconnect.
  private onCampusStatus = (status: CampusStatus) => {
    if (this.streamingOver === null || this.busy || status.flashing) {
      return;
    }
    const transport = campusDataTransport(status);
    if (transport === this.streamingOver) {
      return;
    }
    this.stopStreaming();
    if (transport === null) {
      this.setStatus(ConnectionStatus.DISCONNECTED);
      return;
    }
    void this.streamWhenProgramRuns(transport);
  };

  private async streamWhenProgramRuns(transport: CampusTransport) {
    const generation = this.generation;
    const runs = await this.runsProgram(transport);
    if (generation !== this.generation || this.busy) {
      return;
    }
    if (runs && campusDataTransport(this.host.status) === transport) {
      this.startStreaming(transport);
      this.setStatus(ConnectionStatus.CONNECTED);
    } else {
      this.setStatus(ConnectionStatus.DISCONNECTED);
    }
  }

  async initialize(): Promise<void> {}

  dispose(): void {
    this.stopStreaming();
  }

  async connect(): Promise<ConnectionStatus> {
    if (this.busy) {
      return this.status;
    }
    this.busy = true;
    this.stopStreaming();
    this.setStatus(ConnectionStatus.CONNECTING);
    try {
      const { ble, usb } = this.host.status;
      if (ble !== "connected" && usb !== "connected") {
        // Posted before any await, so Campus still has the click's user
        // activation for the browser's Bluetooth chooser.
        const { ok } = await this.host.connect();
        if (!ok) {
          return this.fail();
        }
      }
      let transport = campusDataTransport(this.host.status);
      if (!transport || !(await this.runsProgram(transport))) {
        if (!(await this.flashProgram())) {
          return this.fail();
        }
        transport = campusDataTransport(this.host.status);
        if (!transport || !(await this.runsProgram(transport))) {
          return this.fail();
        }
      }
      this.startStreaming(transport);
      this.setStatus(ConnectionStatus.CONNECTED);
      return this.status;
    } catch {
      return this.fail();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Follows a link Campus already holds (made in its connection widget):
   * streams when the mini runs the ML data program (or, over Bluetooth, the
   * data collection program). Unlike connect() it never asks Campus for a
   * link and never flashes.
   */
  async follow(): Promise<ConnectionStatus> {
    const transport = campusDataTransport(this.host.status);
    if (this.streamingOver !== null || this.busy || transport === null) {
      return this.status;
    }
    this.busy = true;
    this.setStatus(ConnectionStatus.CONNECTING);
    try {
      if (!(await this.runsProgram(transport))) {
        return this.fail();
      }
      this.startStreaming(transport);
      this.setStatus(ConnectionStatus.CONNECTED);
      return this.status;
    } catch {
      return this.fail();
    } finally {
      this.busy = false;
    }
  }

  private fail(): ConnectionStatus {
    this.setStatus(ConnectionStatus.DISCONNECTED);
    return this.status;
  }

  // Over USB Campus has recognised the program by its ML_INFO frame. Over
  // Bluetooth the accelerometer service only exists while the data collection
  // or ML data program runs; Campus answers a read of a missing
  // characteristic with no bytes.
  private async runsProgram(transport: CampusTransport): Promise<boolean> {
    if (transport === "usb") {
      return this.host.status.program === "ml-data";
    }
    const period = await this.host.read(
      ACCELEROMETER_SERVICE,
      ACCELEROMETER_PERIOD
    );
    return period.byteLength >= 2;
  }

  private async flashProgram(): Promise<boolean> {
    const hex = await mlDataProgramHex(
      this.host.status.boardVersion,
      this.loadHex
    );
    const { ok } = await this.host.flash(hex, ML_DATA_PROGRAM_NAME);
    return ok && (await this.waitForProgram());
  }

  // After a flash the mini restarts: wait until Campus has a link again and,
  // over USB, has recognised the program.
  private waitForProgram(): Promise<boolean> {
    const ready = (s: CampusStatus) => campusDataTransport(s) !== null;
    if (ready(this.host.status)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, this.reconnectAfterFlashMs);
      const unsubscribe = this.host.addStatusListener((s) => {
        if (ready(s)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  private onAccelerometer(x: number, y: number, z: number) {
    this.dispatchTypedEvent(
      "accelerometerdatachanged",
      accelerometerDataEvent({ x, y, z })
    );
  }

  private onButton(button: "A" | "B", value: number) {
    const state = buttonState(value);
    if (state === undefined) {
      return;
    }
    const type = button === "A" ? "buttonachanged" : "buttonbchanged";
    this.dispatchTypedEvent(type, buttonEvent(type, state));
  }

  private startStreaming(transport: CampusTransport) {
    if (this.streamingOver !== null) {
      return;
    }
    this.generation++;
    this.streamingOver = transport;
    if (transport === "usb") {
      // MOTION: X, Y, Z int16 LE in milli-g, then a sequence number. The
      // trainer stamps samples on arrival, as over Bluetooth.
      this.host.subscribe(ML_SERVICE, ML_MOTION, (view) => {
        if (view.byteLength < 6) {
          return;
        }
        this.onAccelerometer(
          view.getInt16(0, true),
          view.getInt16(2, true),
          view.getInt16(4, true)
        );
      });
      // BUTTON: [button (1 = A, 2 = B), state].
      this.host.subscribe(ML_SERVICE, ML_BUTTON, (view) => {
        if (view.byteLength < 2) {
          return;
        }
        const button = view.getUint8(0);
        if (button === 1 || button === 2) {
          this.onButton(button === 1 ? "A" : "B", view.getUint8(1));
        }
      });
      return;
    }
    this.host.subscribe(ACCELEROMETER_SERVICE, ACCELEROMETER_DATA, (view) => {
      if (view.byteLength < 6) {
        return;
      }
      this.onAccelerometer(
        view.getInt16(0, true),
        view.getInt16(2, true),
        view.getInt16(4, true)
      );
    });
    for (const [characteristic, button] of [
      [BUTTON_A, "A"],
      [BUTTON_B, "B"],
    ] as const) {
      this.host.subscribe(BUTTON_SERVICE, characteristic, (view) => {
        if (view.byteLength < 1) {
          return;
        }
        this.onButton(button, view.getUint8(0));
      });
    }
  }

  private stopStreaming() {
    if (this.streamingOver === null) {
      return;
    }
    this.generation++;
    if (this.streamingOver === "usb") {
      this.host.unsubscribe(ML_SERVICE, ML_MOTION);
      this.host.unsubscribe(ML_SERVICE, ML_BUTTON);
    } else {
      this.host.unsubscribe(ACCELEROMETER_SERVICE, ACCELEROMETER_DATA);
      this.host.unsubscribe(BUTTON_SERVICE, BUTTON_A);
      this.host.unsubscribe(BUTTON_SERVICE, BUTTON_B);
    }
    this.streamingOver = null;
  }

  // Campus keeps its link (the connection widget's own button ends it); the
  // trainer only stops listening.
  disconnect(): Promise<void> {
    this.stopStreaming();
    this.setStatus(ConnectionStatus.DISCONNECTED);
    return Promise.resolve();
  }

  getBoardVersion(): BoardVersion | undefined {
    return this.host.status.boardVersion ?? undefined;
  }

  // The device is chosen in Campus' connection widget.
  setNameFilter(_name: string): void {}
  clearDevice(): void {}

  async serialWrite(_data: string): Promise<void> {}
  async getAccelerometerData(): Promise<undefined> {}
  async getAccelerometerPeriod(): Promise<undefined> {}
  async setAccelerometerPeriod(_value: number): Promise<void> {}
  async setLedText(_text: string): Promise<void> {}
  async getLedScrollingDelay(): Promise<undefined> {}
  async setLedScrollingDelay(_delayInMillis: number): Promise<void> {}
  async getLedMatrix(): Promise<undefined> {}
  async setLedMatrix(_matrix: LedMatrix): Promise<void> {}
  async getMagnetometerData(): Promise<undefined> {}
  async getMagnetometerBearing(): Promise<undefined> {}
  async getMagnetometerPeriod(): Promise<undefined> {}
  async setMagnetometerPeriod(_value: number): Promise<void> {}
  async triggerMagnetometerCalibration(): Promise<void> {}
  async uartWrite(_data: Uint8Array): Promise<void> {}
}

let campusConnection: CampusConnection | undefined;

/** The one Campus connection of this page (only in Campus mode). */
export const getCampusConnection = (): CampusConnection => {
  if (!campusConnection) {
    campusConnection = new CampusConnection(getCampusHost());
  }
  return campusConnection;
};
