/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * The data collection mini's Bluetooth connection in Campus mode (see
 * campus-host.ts). Campus holds the real link; this class asks it to connect,
 * makes sure the mini runs the data collection program (flashing it through
 * Campus if not) and turns the accelerometer and button notifications Campus
 * forwards into the events the trainer listens to.
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
import { CampusHost, CampusStatus } from "./campus-host";
import { getHexFileUrl, HexType } from "./get-hex-file";

// micro:bit Bluetooth profile, as the data collection program exposes it.
const ACCELEROMETER_SERVICE = "e95d0753-251d-470a-a062-fa1922dfa9a8";
const ACCELEROMETER_DATA = "e95dca4b-251d-470a-a062-fa1922dfa9a8";
const ACCELEROMETER_PERIOD = "e95dfb24-251d-470a-a062-fa1922dfa9a8";
const BUTTON_SERVICE = "e95d9882-251d-470a-a062-fa1922dfa9a8";
const BUTTON_A = "e95dda90-251d-470a-a062-fa1922dfa9a8";
const BUTTON_B = "e95dda91-251d-470a-a062-fa1922dfa9a8";

// The library exports its event classes as types only; these build the same
// shape (an Event with the payload on it).
const accelerometerDataEvent = (data: AccelerometerData) =>
  Object.assign(new Event("accelerometerdatachanged"), {
    data,
  }) as AccelerometerDataEvent;

const buttonEvent = (type: ButtonEventType, state: ButtonState) =>
  Object.assign(new Event(type), { state }) as ButtonEvent;

/** How long the mini may take to come back over Bluetooth after a flash. */
const RECONNECT_AFTER_FLASH_MS = 45_000;

export class CampusBluetoothConnection
  extends TypedEventTarget<DeviceConnectionEventMap & ServiceConnectionEventMap>
  implements MicrobitWebBluetoothConnection
{
  status: ConnectionStatus = ConnectionStatus.NO_AUTHORIZED_DEVICE;
  private streaming = false;

  constructor(private host: CampusHost) {
    super();
    host.addStatusListener(this.onCampusStatus);
  }

  private setStatus(status: ConnectionStatus) {
    if (status === this.status) {
      return;
    }
    this.status = status;
    this.dispatchTypedEvent("status", new ConnectionStatusEvent(status));
  }

  // Campus lost the link while data was streaming: report it like a dropped
  // Bluetooth connection, so the trainer offers to reconnect.
  private onCampusStatus = (status: CampusStatus) => {
    if (
      this.streaming &&
      status.ble !== "connected" &&
      !status.flashing &&
      this.status === ConnectionStatus.CONNECTED
    ) {
      this.stopStreaming();
      this.setStatus(ConnectionStatus.DISCONNECTED);
    }
  };

  async initialize(): Promise<void> {}

  dispose(): void {
    this.stopStreaming();
  }

  async connect(): Promise<ConnectionStatus> {
    this.setStatus(ConnectionStatus.CONNECTING);
    try {
      if (this.host.status.ble !== "connected") {
        // Posted before any await, so Campus still has the click's user
        // activation for the browser's Bluetooth chooser.
        const { ok } = await this.host.connect();
        if (!ok) {
          return this.fail();
        }
      }
      if (!(await this.runsDataCollectionProgram())) {
        const flashed = await this.flashDataCollectionProgram();
        if (!flashed || !(await this.runsDataCollectionProgram())) {
          return this.fail();
        }
      }
      this.startStreaming();
      this.setStatus(ConnectionStatus.CONNECTED);
      return this.status;
    } catch {
      return this.fail();
    }
  }

  private fail(): ConnectionStatus {
    this.setStatus(ConnectionStatus.DISCONNECTED);
    return this.status;
  }

  // The accelerometer service only exists while the data collection program
  // runs; Campus answers a read of a missing characteristic with no bytes.
  private async runsDataCollectionProgram(): Promise<boolean> {
    const period = await this.host.read(
      ACCELEROMETER_SERVICE,
      ACCELEROMETER_PERIOD
    );
    return period.byteLength >= 2;
  }

  private async flashDataCollectionProgram(): Promise<boolean> {
    const url = getHexFileUrl("universal", HexType.Bluetooth);
    if (!url) {
      return false;
    }
    const response = await fetch(url);
    if (!response.ok) {
      return false;
    }
    const { ok } = await this.host.flash(
      await response.text(),
      "data-collection-program"
    );
    return ok && (await this.waitForBluetooth());
  }

  private waitForBluetooth(): Promise<boolean> {
    const ready = (s: CampusStatus) => s.ble === "connected" && !s.flashing;
    if (ready(this.host.status)) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, RECONNECT_AFTER_FLASH_MS);
      const unsubscribe = this.host.addStatusListener((s) => {
        if (ready(s)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  private startStreaming() {
    if (this.streaming) {
      return;
    }
    this.streaming = true;
    this.host.subscribe(ACCELEROMETER_SERVICE, ACCELEROMETER_DATA, (view) => {
      if (view.byteLength < 6) {
        return;
      }
      this.dispatchTypedEvent(
        "accelerometerdatachanged",
        accelerometerDataEvent({
          x: view.getInt16(0, true),
          y: view.getInt16(2, true),
          z: view.getInt16(4, true),
        })
      );
    });
    for (const [characteristic, type] of [
      [BUTTON_A, "buttonachanged"],
      [BUTTON_B, "buttonbchanged"],
    ] as const) {
      this.host.subscribe(BUTTON_SERVICE, characteristic, (view) => {
        if (view.byteLength < 1) {
          return;
        }
        this.dispatchTypedEvent(
          type,
          buttonEvent(type, view.getUint8(0) as ButtonState)
        );
      });
    }
  }

  private stopStreaming() {
    if (!this.streaming) {
      return;
    }
    this.streaming = false;
    this.host.unsubscribe(ACCELEROMETER_SERVICE, ACCELEROMETER_DATA);
    this.host.unsubscribe(BUTTON_SERVICE, BUTTON_A);
    this.host.unsubscribe(BUTTON_SERVICE, BUTTON_B);
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
