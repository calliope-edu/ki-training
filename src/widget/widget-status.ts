/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * The connection widget's state, reduced to the status Campus reports to the
 * trainer (see device/campus-host.ts). The same reduction as Campus'
 * `kiTrainingStatus` (calliope-campus src/lib/kiTraining/kiTraining.ts), so
 * the trainer behaves alike in Campus and with the widget on its own page.
 */
import type { CampusLinkStatus, CampusStatus } from "../device/campus-host";

/** The fields of the widget's `CalliopeState` the status is made of. */
export interface WidgetState {
  status: string;
  usbStatus: string;
  jlinkSerialStatus: string;
  jlinkUsbStatus: string;
  bleStatus: string;
  boardVersion?: string;
  calliopeVersion?: string;
  flashInProgress?: boolean;
  programType?: string;
}

const linkStatus = (...statuses: string[]): CampusLinkStatus => {
  if (statuses.some((s) => s === "connected" || s === "flashing")) {
    return "connected";
  }
  if (statuses.some((s) => s === "connecting")) {
    return "connecting";
  }
  return "disconnected";
};

/**
 * The micro:bit board class: from the connection, else from the mini's
 * Calliope version (a mini 2 over its J-Link reports no board version).
 */
const boardClass = (state: WidgetState): CampusStatus["boardVersion"] => {
  if (state.boardVersion === "V1" || state.boardVersion === "V2") {
    return state.boardVersion;
  }
  if (state.calliopeVersion === "V1" || state.calliopeVersion === "V2") {
    return "V1";
  }
  if (state.calliopeVersion === "V3") {
    return "V2";
  }
  return null;
};

const detectedProgram = (
  programType: string | undefined
): CampusStatus["program"] =>
  programType === "ml-data" ||
  programType === "blocks" ||
  programType === "unknown"
    ? programType
    : null;

/** What the trainer learns about the mini from the widget. */
export const widgetStatus = (state: WidgetState): CampusStatus => {
  const flashing =
    state.flashInProgress === true || state.status === "flashing";
  return {
    ble: linkStatus(state.bleStatus),
    usb: linkStatus(
      state.usbStatus,
      state.jlinkSerialStatus,
      state.jlinkUsbStatus
    ),
    boardVersion: boardClass(state),
    flashing,
    program: flashing ? null : detectedProgram(state.programType),
  };
};
