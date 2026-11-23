/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 */
import { WidgetState, widgetStatus } from "./widget-status";

const disconnected: WidgetState = {
  status: "disconnected",
  usbStatus: "disconnected",
  jlinkSerialStatus: "disconnected",
  jlinkUsbStatus: "disconnected",
  bleStatus: "disconnected",
};

describe("widgetStatus", () => {
  it("reports no link without a mini", () => {
    expect(widgetStatus(disconnected)).toEqual({
      ble: "disconnected",
      usb: "disconnected",
      boardVersion: null,
      flashing: false,
      program: null,
    });
  });

  it("reports a mini 3 over USB running the ML data program", () => {
    expect(
      widgetStatus({
        ...disconnected,
        status: "connected",
        usbStatus: "connected",
        boardVersion: "V2",
        programType: "ml-data",
      })
    ).toEqual({
      ble: "disconnected",
      usb: "connected",
      boardVersion: "V2",
      flashing: false,
      program: "ml-data",
    });
  });

  it("counts a mini 2's J-Link as USB and tells its board class", () => {
    const status = widgetStatus({
      ...disconnected,
      status: "connected",
      jlinkUsbStatus: "connected",
      calliopeVersion: "V2",
    });
    expect(status.usb).toBe("connected");
    expect(status.boardVersion).toBe("V1");
  });

  it("hides the program while a transfer runs", () => {
    const status = widgetStatus({
      ...disconnected,
      status: "flashing",
      usbStatus: "flashing",
      bleStatus: "connecting",
      programType: "ml-data",
      flashInProgress: true,
    });
    expect(status).toMatchObject({
      ble: "connecting",
      usb: "connected",
      flashing: true,
      program: null,
    });
  });
});
