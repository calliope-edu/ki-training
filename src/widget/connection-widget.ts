/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * The connection widget (@calliope-edu/mini-connection-widget) on the
 * trainer's own page, doing for the trainer what Calliope Campus does on
 * /ki-training (calliope-campus src/lib/components/editors/KiTraining.svelte):
 * it owns the mini, connects it over USB or Bluetooth, transfers programs and
 * hands the trainer the ML data program's motion and button data.
 *
 * Only device/widget-host.ts loads this module (lazily), so the trainer
 * embedded in Campus never loads the widget.
 *
 * Data reaches the trainer as through Campus' GATT proxy (see
 * device/campus-host.ts): over Bluetooth from the micro:bit accelerometer and
 * button services, over USB from the ML data program's serial channels,
 * addressed as `0b50XXXX-…` for channel 0xXXXX, each NOTIFY frame as it
 * arrives.
 */
import "@calliope-edu/ui/tokens.css";
import {
  BLOCKS_RES,
  BlocksFrame,
  CalliopeState,
  calliopeState,
  connectCalliope,
  flashCalliope,
  getConnectedBleDevice,
  initializeCalliopeConnection,
  onMlDataFrame,
  setConnectLabels,
  setConnectionUiActive,
} from "@calliope-edu/mini-connection-widget";
import { mount } from "svelte";
import type { CampusStatus } from "../device/campus-host";
import ConnectionWidget from "./ConnectionWidget.svelte";
import { englishConnectLabels } from "./connect-labels-en";
import { widgetStatus } from "./widget-status";
import { widgetView } from "./widget-view";

export type WidgetResult = { ok: boolean; error?: string };

type NotifyListener = (data: DataView) => void;

let state: CalliopeState | undefined;

/**
 * Starts the widget: its connection layer, and its button, banner and
 * dialogs on the page. `onStatus` gets every change of the mini's links.
 */
export const startConnectionWidget = (
  onStatus: (status: CampusStatus) => void
) => {
  initializeCalliopeConnection();
  // The trainer is all about the mini: the banner may offer to connect.
  setConnectionUiActive(true);
  calliopeState.subscribe((s) => {
    state = s;
    if (s.bleStatus !== "connected") {
      dropBle();
    }
    onStatus(widgetStatus(s));
  });
  const target = document.createElement("div");
  target.id = "connection-widget";
  document.body.appendChild(target);
  mount(ConnectionWidget, { target });
};

/** The widget's texts follow the trainer's language: German, else English. */
export const setWidgetLanguage = (languageId: string) => {
  setConnectLabels(
    languageId.toLowerCase().startsWith("de") ? undefined : englishConnectLabels
  );
};

export const setWidgetView = (view: "trainer" | "makecode") => {
  widgetView.set(view);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A Bluetooth link for data collection, as the trainer asks Campus for one. */
export const connectBluetooth = async (): Promise<WidgetResult> => {
  try {
    if (state?.bleStatus !== "connected") {
      await connectCalliope("ble");
    }
    return { ok: state?.bleStatus === "connected" };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
};

/**
 * Puts a program onto the mini: over the link the widget holds, or it asks
 * how. It shows progress and errors itself.
 */
export const flash = async (
  hex: string,
  name: string
): Promise<WidgetResult> => {
  try {
    await flashCalliope(hex, name);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
};

// ---- USB: the ML data program's serial channels ----------------------------

/** The serial channel a `0b50XXXX-…` characteristic names, or null. */
const mlChannel = (characteristicId: string): number | null =>
  /^0b50[0-9a-f]{4}-/i.test(characteristicId)
    ? parseInt(characteristicId.slice(4, 8), 16)
    : null;

const charKey = (serviceId: string, characteristicId: string) =>
  `${serviceId.toLowerCase()}|${characteristicId.toLowerCase()}`;

const mlListeners = new Map<
  string,
  { channel: number; listener: NotifyListener }
>();
let unsubscribeMl: (() => void) | undefined;

const onMlFrame = (frame: BlocksFrame) => {
  if (frame.type !== BLOCKS_RES.NOTIFY) {
    return;
  }
  for (const { channel, listener } of mlListeners.values()) {
    if (channel === frame.channel) {
      listener(
        new DataView(
          frame.data.buffer,
          frame.data.byteOffset,
          frame.data.byteLength
        )
      );
    }
  }
};

// ---- Bluetooth: GATT on the widget's link ----------------------------------

let bleServer: BluetoothRemoteGATTServer | null = null;
const bleChars = new Map<string, BluetoothRemoteGATTCharacteristic>();
const bleListeners = new Map<string, (event: Event) => void>();
// GATT operations one after the other: Web Bluetooth refuses overlapping ones.
let queue: Promise<unknown> = Promise.resolve();

const enqueue = <T>(op: () => Promise<T>): Promise<T> => {
  const next = queue.then(op, op);
  queue = next.catch(() => undefined);
  return next;
};

/** Forgets the GATT objects of a link that is gone, so a new one binds afresh. */
const dropBle = () => {
  if (!bleServer && bleChars.size === 0 && bleListeners.size === 0) {
    return;
  }
  for (const [key, listener] of bleListeners) {
    bleChars
      .get(key)
      ?.removeEventListener("characteristicvaluechanged", listener);
  }
  bleListeners.clear();
  bleChars.clear();
  bleServer = null;
};

const RESOLVE_TIMEOUT_MS = 1500;
const RESOLVE_RETRY_MS = 150;

const getBleChar = async (
  serviceId: string,
  characteristicId: string
): Promise<BluetoothRemoteGATTCharacteristic | null> => {
  const key = charKey(serviceId, characteristicId);
  const cached = bleChars.get(key);
  if (cached && bleServer?.connected) {
    return cached;
  }
  const device = await getConnectedBleDevice();
  if (!device?.gatt) {
    return null;
  }
  if (!bleServer?.connected) {
    try {
      bleServer = await device.gatt.connect();
      bleChars.clear();
    } catch {
      bleServer = null;
      return null;
    }
  }
  // Right after connecting, service discovery may still run (slower stacks,
  // Windows): retry for a moment, as Campus does.
  const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
  for (;;) {
    if (!bleServer?.connected) {
      return null;
    }
    try {
      const service = await bleServer.getPrimaryService(
        serviceId.toLowerCase()
      );
      const char = await service.getCharacteristic(
        characteristicId.toLowerCase()
      );
      bleChars.set(key, char);
      return char;
    } catch {
      if (Date.now() + RESOLVE_RETRY_MS >= deadline) {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, RESOLVE_RETRY_MS));
    }
  }
};

const empty = () => new DataView(new ArrayBuffer(0));

const copy = (value: DataView) =>
  new DataView(
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
  );

/** Reads a characteristic; no bytes when the mini does not have it. */
export const read = (
  serviceId: string,
  characteristicId: string,
  timeoutMs: number
): Promise<DataView> => {
  if (mlChannel(characteristicId) !== null) {
    // The trainer tells the ML data program over USB by the widget's status.
    return Promise.resolve(empty());
  }
  const reading = enqueue(async () => {
    const char = await getBleChar(serviceId, characteristicId);
    if (!char) {
      return empty();
    }
    try {
      return copy(await char.readValue());
    } catch {
      return empty();
    }
  });
  const timeout = new Promise<DataView>((resolve) =>
    setTimeout(() => resolve(empty()), timeoutMs)
  );
  return Promise.race([reading, timeout]);
};

export const subscribe = (
  serviceId: string,
  characteristicId: string,
  listener: NotifyListener
) => {
  const key = charKey(serviceId, characteristicId);
  const channel = mlChannel(characteristicId);
  if (channel !== null) {
    mlListeners.set(key, { channel, listener });
    unsubscribeMl ??= onMlDataFrame(onMlFrame);
    return;
  }
  void enqueue(async () => {
    if (bleListeners.has(key)) {
      return;
    }
    const char = await getBleChar(serviceId, characteristicId);
    if (!char) {
      return;
    }
    const onChange = () => {
      if (char.value) {
        listener(char.value);
      }
    };
    char.addEventListener("characteristicvaluechanged", onChange);
    bleListeners.set(key, onChange);
    try {
      await char.startNotifications();
    } catch {
      char.removeEventListener("characteristicvaluechanged", onChange);
      bleListeners.delete(key);
    }
  });
};

export const unsubscribe = (serviceId: string, characteristicId: string) => {
  const key = charKey(serviceId, characteristicId);
  if (mlChannel(characteristicId) !== null) {
    mlListeners.delete(key);
    if (mlListeners.size === 0 && unsubscribeMl) {
      unsubscribeMl();
      unsubscribeMl = undefined;
    }
    return;
  }
  void enqueue(async () => {
    const listener = bleListeners.get(key);
    const char = bleChars.get(key);
    bleListeners.delete(key);
    if (!listener || !char) {
      return;
    }
    char.removeEventListener("characteristicvaluechanged", listener);
    try {
      await char.stopNotifications();
    } catch {
      // The link may be gone already.
    }
  });
};
