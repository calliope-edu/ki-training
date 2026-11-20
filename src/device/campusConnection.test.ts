/**
 * @vitest-environment jsdom
 */
/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 */
import {
  AccelerometerDataEvent,
  ButtonEvent,
  ConnectionStatus,
} from "@microbit/microbit-connection";
import {
  isUniversalHex,
  separateUniversalHex,
} from "@microbit/microbit-universal-hex";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCELEROMETER_DATA,
  ACCELEROMETER_SERVICE,
  campusDataTransport,
  CampusConnection,
  ML_DATA_PROGRAM_NAME,
  ML_MOTION,
  ML_SERVICE,
  mlChannelUuid,
  mlDataProgramHex,
  MlDataHexFile,
} from "./campusConnection";
import {
  SimulatedCampusHost,
  SimulatedCampusOptions,
  SimulatedMlDataProgram,
} from "./campusSimulation";
import { disconnectedCampusStatus } from "./campus-host";

const loadHex = (file: MlDataHexFile) =>
  Promise.resolve(
    readFileSync(
      path.join(__dirname, "firmware", `calliope-ml-data-${file}.hex`),
      "utf-8"
    )
  );

const setup = (options: SimulatedCampusOptions = {}) => {
  const host = new SimulatedCampusHost({
    flashMs: 2000,
    linkMs: 300,
    ...options,
  });
  const hexLoader = vi.fn(loadHex);
  const connection = new CampusConnection(host, {
    loadHex: hexLoader,
    reconnectAfterFlashMs: 10_000,
  });
  const samples: { x: number; y: number; z: number }[] = [];
  connection.addEventListener(
    "accelerometerdatachanged",
    (e: AccelerometerDataEvent) => {
      samples.push(e.data);
    }
  );
  const buttons: string[] = [];
  const onButton = (e: ButtonEvent) => {
    buttons.push(`${e.type === "buttonachanged" ? "A" : "B"}${e.state}`);
  };
  connection.addEventListener("buttonachanged", onButton);
  connection.addEventListener("buttonbchanged", onButton);
  const flash = vi.spyOn(host, "flash");
  const connect = vi.spyOn(host, "connect");
  return { host, connection, samples, buttons, flash, connect, hexLoader };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("campusDataTransport", () => {
  it("reads over Bluetooth whenever Campus holds that link", () => {
    expect(
      campusDataTransport({
        ...disconnectedCampusStatus,
        ble: "connected",
        usb: "connected",
        program: "ml-data",
      })
    ).toBe("ble");
  });

  it("reads over USB only once Campus recognised the ML data program", () => {
    const usb = { ...disconnectedCampusStatus, usb: "connected" as const };
    expect(campusDataTransport(usb)).toBeNull();
    expect(campusDataTransport({ ...usb, program: "blocks" })).toBeNull();
    expect(campusDataTransport({ ...usb, program: "ml-data" })).toBe("usb");
    expect(
      campusDataTransport({ ...usb, program: "ml-data", flashing: true })
    ).toBeNull();
  });
});

describe("mlChannelUuid", () => {
  it("addresses a serial channel the way Campus maps Blocks UUIDs", () => {
    expect(mlChannelUuid(0x0203)).toBe("0b500203-607f-4151-9091-7d008d6ffc5c");
  });
});

describe("mlDataProgramHex", () => {
  it("picks the build for the board", async () => {
    expect(await mlDataProgramHex("V1", loadHex)).toBe(await loadHex("dal"));
    expect(await mlDataProgramHex("V2", loadHex)).toBe(await loadHex("codal"));
  });

  it("builds a universal hex from both when the board is not known", async () => {
    const hex = await mlDataProgramHex(null, loadHex);
    expect(isUniversalHex(hex)).toBe(true);
    expect(
      separateUniversalHex(hex)
        .map((part) => part.boardId)
        .sort()
    ).toEqual([0x9900, 0x9903]);
  });
});

describe("SimulatedMlDataProgram", () => {
  it("sends MOTION every 20 ms with a wrapping sequence number", () => {
    const program = new SimulatedMlDataProgram();
    const frames: Uint8Array[] = [];
    program.addFrameListener((channel, data) => {
      if (channel === 0x0203) {
        frames.push(data);
      }
    });
    program.start();
    vi.advanceTimersByTime(6000);
    program.stop();
    expect(frames).toHaveLength(300);
    expect(frames[0]).toHaveLength(7);
    expect(frames.map((f) => f[6]).slice(254, 258)).toEqual([254, 255, 0, 1]);
    const z = new DataView(frames[0].buffer).getInt16(4, true);
    expect(z).toBeLessThan(-900);
  });

  it("identifies itself in ML_INFO", () => {
    const info = new SimulatedMlDataProgram("V1").info();
    expect([...info.slice(0, 6)]).toEqual([1, 0x4d, 1, 1, 20, 2]);
  });
});

describe("CampusConnection", () => {
  it("follows a USB link to the ML data program and streams 50 samples/s", async () => {
    const { connection, samples, flash, connect } = setup();
    expect(await connection.follow()).toBe(ConnectionStatus.CONNECTED);
    expect(connection.streamingOver).toBe("usb");
    await vi.advanceTimersByTimeAsync(1000);
    expect(samples).toHaveLength(50);
    expect(samples[0].z).toBeLessThan(-900);
    expect(flash).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("turns BUTTON frames into button events", async () => {
    const { host, connection, buttons } = setup();
    await connection.follow();
    host.program.press("A");
    await vi.advanceTimersByTimeAsync(200);
    host.program.press("B", 2000);
    await vi.advanceTimersByTimeAsync(2100);
    // 1 = pressed, 2 = long press, 0 = released.
    expect(buttons).toEqual(["A1", "A0", "B1", "B2", "B0"]);
  });

  it("follows a Bluetooth link to the data collection services", async () => {
    const { connection, samples } = setup({ usb: false, ble: true });
    expect(await connection.follow()).toBe(ConnectionStatus.CONNECTED);
    expect(connection.streamingOver).toBe("ble");
    await vi.advanceTimersByTimeAsync(1000);
    expect(samples).toHaveLength(50);
  });

  it("never flashes when following", async () => {
    const usb = setup({ program: "blocks" });
    expect(await usb.connection.follow()).toBe(
      ConnectionStatus.NO_AUTHORIZED_DEVICE
    );
    const ble = setup({ usb: false, ble: true, program: "blocks" });
    expect(await ble.connection.follow()).toBe(ConnectionStatus.DISCONNECTED);
    expect(usb.flash).not.toHaveBeenCalled();
    expect(ble.flash).not.toHaveBeenCalled();
    expect(ble.connection.streamingOver).toBeNull();
  });

  it("flashes the build for the board over USB on connect, then streams", async () => {
    const { connection, samples, flash, connect, hexLoader } = setup({
      program: "blocks",
      boardVersion: "V1",
    });
    const result = connection.connect();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe(ConnectionStatus.CONNECTED);
    expect(connect).not.toHaveBeenCalled();
    expect(hexLoader).toHaveBeenCalledWith("dal");
    expect(flash).toHaveBeenCalledWith(
      await loadHex("dal"),
      ML_DATA_PROGRAM_NAME
    );
    expect(connection.streamingOver).toBe("usb");
    await vi.advanceTimersByTimeAsync(1000);
    expect(samples.length).toBeGreaterThanOrEqual(49);
  });

  it("asks Campus for a Bluetooth link when it holds none", async () => {
    const { connection, flash, connect } = setup({ usb: false });
    const result = connection.connect();
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe(ConnectionStatus.CONNECTED);
    expect(connect).toHaveBeenCalledOnce();
    expect(flash).not.toHaveBeenCalled();
    expect(connection.streamingOver).toBe("ble");
  });

  it("does not flash on connect when the ML data program runs", async () => {
    const { connection, flash } = setup();
    expect(await connection.connect()).toBe(ConnectionStatus.CONNECTED);
    expect(flash).not.toHaveBeenCalled();
  });

  it("fails when the program does not come back after the flash", async () => {
    const { host, connection } = setup({ program: "blocks" });
    vi.spyOn(host, "flash").mockResolvedValue({ ok: true });
    const result = connection.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBe(ConnectionStatus.DISCONNECTED);
  });

  it("moves between USB and Bluetooth as Campus does", async () => {
    const { host, connection, samples } = setup();
    await connection.follow();
    host.setLinks({ ble: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.streamingOver).toBe("ble");
    expect(host.subscriptions).toContain(
      `${ACCELEROMETER_SERVICE}|${ACCELEROMETER_DATA}`
    );
    expect(host.subscriptions).not.toContain(`${ML_SERVICE}|${ML_MOTION}`);
    host.setLinks({ ble: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.streamingOver).toBe("usb");
    expect(connection.status).toBe(ConnectionStatus.CONNECTED);
    samples.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    expect(samples).toHaveLength(50);
  });

  it("reports a link Campus lost as disconnected", async () => {
    const { host, connection } = setup();
    await connection.follow();
    host.setLinks({ usb: false });
    expect(connection.status).toBe(ConnectionStatus.DISCONNECTED);
    expect(connection.streamingOver).toBeNull();
    expect(host.subscriptions).toEqual([]);
  });

  it("stops listening on dispose", async () => {
    const { host, connection, samples } = setup();
    await connection.follow();
    connection.dispose();
    expect(host.subscriptions).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(samples).toHaveLength(0);
  });
});
