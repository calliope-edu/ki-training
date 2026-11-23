/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * The part of @calliope-edu/mini-connection-widget the trainer uses, typed
 * here (tsconfig.json `paths`). The widget ships its TypeScript source, which
 * is written against its own @microbit/microbit-connection 1.0.0-beta.1, not
 * the fork the trainer type-checks against, so the trainer does not compile
 * it. Vite resolves the real package at build time.
 */

export type CalliopeStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "flashing"
  | "error";

export interface CalliopeState {
  status: CalliopeStatus;
  usbStatus: CalliopeStatus;
  jlinkSerialStatus: CalliopeStatus;
  jlinkUsbStatus: CalliopeStatus;
  bleStatus: CalliopeStatus;
  boardVersion?: "V1" | "V2";
  calliopeVersion?: "V1" | "V2" | "V3";
  flashInProgress?: boolean;
  programType?: string;
}

export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

export const calliopeState: Readable<CalliopeState>;

export function initializeCalliopeConnection(): void;

export function connectCalliope(
  transport?: "usb" | "ble",
  forceChooser?: boolean,
  nameFilter?: string
): Promise<void>;

export function flashCalliope(hex: string, name?: string): Promise<void>;

export function getConnectedBleDevice(): Promise<BluetoothDevice | null>;

export function setConnectionUiActive(active: boolean): void;

export interface BlocksFrame {
  type: number;
  channel: number;
  data: Uint8Array;
}

export function onMlDataFrame(cb: (frame: BlocksFrame) => void): () => void;

export const BLOCKS_RES: { readonly NOTIFY: number; readonly READ: number };

// The real type names each text and its parameters; only hosts write them.
export type ConnectLabels = Record<
  string,
  string | ((params: never) => string)
>;

export function setConnectLabels(overrides?: Partial<ConnectLabels>): void;
