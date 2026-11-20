/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * Campus mode: the trainer's connection follows Campus' connection widget
 * (see device/campus-host.ts). A mini connected in the widget is picked up
 * without a click, a link the widget loses ends the trainer's connection
 * quietly, and the trainer shows how the mini is connected (USB, Bluetooth).
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { ConnectionStatus } from "./connect-status-hooks";
import { useConnectionStage } from "./connection-stage-hooks";
import {
  CampusStatus,
  disconnectedCampusStatus,
  getCampusHost,
  isCampusMode,
  isCampusSimulation,
} from "./device/campus-host";
import { getCampusBluetooth } from "./device/campusBluetooth";
import {
  campusDataTransport,
  getCampusConnection,
} from "./device/campusConnection";

// Campus mode still reads motion data over Bluetooth only
// (CampusBluetoothConnection). Only the simulated Campus (`?simulate=campus`)
// uses CampusConnection, which reads it over USB as well.

/** The trainer's device connection in Campus mode. */
export const getCampusDevice = () =>
  isCampusSimulation() ? getCampusConnection() : getCampusBluetooth();

/** Whether Campus holds a link the trainer can read motion data over. */
const hasDataLink = (status: CampusStatus) =>
  isCampusSimulation()
    ? campusDataTransport(status) !== null
    : status.ble === "connected";

/** Campus' connection status as it last reported it (disconnected outside Campus). */
export const useCampusStatus = (): CampusStatus => {
  const subscribe = useCallback(
    (onChange: () => void) =>
      isCampusMode() ? getCampusHost().addStatusListener(onChange) : () => {},
    []
  );
  const getSnapshot = useCallback(
    () => (isCampusMode() ? getCampusHost().status : disconnectedCampusStatus),
    []
  );
  return useSyncExternalStore(subscribe, getSnapshot);
};

// Trainer states from which a link the widget holds is picked up. Not
// Disconnected (the user ended it in the trainer) nor anything in progress.
const followable = new Set<ConnectionStatus>([
  ConnectionStatus.NotConnected,
  ConnectionStatus.FailedToConnect,
  ConnectionStatus.FailedToReconnect,
  ConnectionStatus.FailedToReconnectTwice,
  ConnectionStatus.FailedToSelectBluetoothDevice,
  ConnectionStatus.ConnectionLost,
]);

/** Keeps the trainer's connection in step with Campus' widget. Campus mode only. */
export const useCampusConnectionSync = () => {
  const { status, actions } = useConnectionStage();
  const campus = useCampusStatus();
  // One look per link: whether the mini runs the data collection program.
  // Looked at again after the link comes back or a program was transferred.
  const lookedRef = useRef(false);

  useEffect(() => {
    if (campus.flashing) {
      lookedRef.current = false;
      return;
    }
    if (!hasDataLink(campus)) {
      lookedRef.current = false;
      if (status === ConnectionStatus.Connected) {
        // The widget lost or ended the link: no "connection lost" dialog,
        // the live graph just shows the mini is not connected.
        void actions.disconnectInputMicrobit();
      }
      return;
    }
    if (!lookedRef.current && followable.has(status)) {
      lookedRef.current = true;
      actions.followCampusConnection();
      void getCampusDevice().follow();
    }
  }, [actions, campus, status]);
};
