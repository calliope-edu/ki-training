/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * Campus mode: the trainer runs in an iframe of Calliope Campus
 * (`/ki-training`) with `?controller=2&parentOrigin=<campus origin>`. Campus
 * owns the Calliope mini through its connection widget, so the trainer never
 * opens a USB or Bluetooth dialog itself. It asks Campus instead.
 *
 * Message protocol (Campus side: src/lib/kiTraining/kiTraining.ts):
 *   trainer -> campus:  {type: "mltrainer", action: "ready"}
 *                       {type: "mltrainer", action: "connect", reqId}
 *                       {type: "mltrainer", action: "flash", reqId, hex, name}
 *                       {type: "mltrainer", action: "view", view: "trainer" | "makecode"}
 *                       {type: "calliope.read", serviceId, characteristicId, reqId}
 *                       {type: "calliope.subscribe" | "calliope.unsubscribe", serviceId, characteristicId}
 *   campus -> trainer:  {type: "mltrainer", action: "status", ble, usb, boardVersion, flashing}
 *                       {type: "mltrainer", action: "result", reqId, ok, error?}
 *                       {source: "calliope-host", type: "calliope.readResult", reqId, message}
 *                       {source: "calliope-host", type: "calliope.notify", serviceId, characteristicId, message}
 * GATT messages carry their bytes base64-encoded.
 */
import { BoardVersion } from "@microbit/microbit-connection";

const params = new URLSearchParams(window.location.search);

const parentOrigin = (() => {
  const value = params.get("parentOrigin");
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
})();

/** True when the trainer runs embedded in Campus, which owns the mini. */
export const isCampusMode = (): boolean =>
  params.get("controller") === "2" &&
  parentOrigin !== null &&
  window.parent !== window;

export type CampusLinkStatus = "connected" | "connecting" | "disconnected";

export interface CampusStatus {
  ble: CampusLinkStatus;
  usb: CampusLinkStatus;
  boardVersion: BoardVersion | null;
  flashing: boolean;
}

interface IncomingMessage {
  type?: unknown;
  source?: unknown;
  action?: unknown;
  reqId?: unknown;
  ok?: unknown;
  error?: unknown;
  ble?: unknown;
  usb?: unknown;
  boardVersion?: unknown;
  flashing?: unknown;
  serviceId?: unknown;
  characteristicId?: unknown;
  message?: unknown;
}

const linkStatus = (value: unknown): CampusLinkStatus =>
  value === "connected" || value === "connecting" ? value : "disconnected";

const base64ToBytes = (b64: string): Uint8Array => {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
};

const charKey = (serviceId: string, characteristicId: string) =>
  `${serviceId.toLowerCase()}|${characteristicId.toLowerCase()}`;

type StatusListener = (status: CampusStatus) => void;
type NotifyListener = (data: DataView) => void;

/**
 * The trainer's side of the Campus link: requests to Campus, its answers,
 * the connection status it reports and the GATT proxy.
 */
export class CampusHost {
  status: CampusStatus = {
    ble: "disconnected",
    usb: "disconnected",
    boardVersion: null,
    flashing: false,
  };
  private nextReqId = 1;
  private pendingResults = new Map<
    number,
    (result: { ok: boolean; error?: string }) => void
  >();
  private pendingReads = new Map<number, (data: DataView) => void>();
  private statusListeners = new Set<StatusListener>();
  private notifyListeners = new Map<string, NotifyListener>();

  constructor() {
    window.addEventListener("message", this.onMessage);
    this.post({ type: "mltrainer", action: "ready" });
  }

  private post(message: Record<string, unknown>) {
    if (!parentOrigin) {
      return;
    }
    window.parent.postMessage(message, parentOrigin);
  }

  private onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== parentOrigin) {
      return;
    }
    const data = event.data as IncomingMessage | null;
    if (!data || typeof data !== "object") {
      return;
    }
    if (data.type === "mltrainer") {
      if (data.action === "status") {
        this.status = {
          ble: linkStatus(data.ble),
          usb: linkStatus(data.usb),
          boardVersion:
            data.boardVersion === "V1" || data.boardVersion === "V2"
              ? data.boardVersion
              : null,
          flashing: data.flashing === true,
        };
        this.statusListeners.forEach((listener) => listener(this.status));
      } else if (data.action === "result" && typeof data.reqId === "number") {
        const resolve = this.pendingResults.get(data.reqId);
        this.pendingResults.delete(data.reqId);
        resolve?.({
          ok: data.ok === true,
          error: typeof data.error === "string" ? data.error : undefined,
        });
      }
      return;
    }
    if (data.source !== "calliope-host" || typeof data.message !== "string") {
      return;
    }
    const bytes = base64ToBytes(data.message);
    const view = new DataView(bytes.buffer);
    if (data.type === "calliope.readResult" && typeof data.reqId === "number") {
      const resolve = this.pendingReads.get(data.reqId);
      this.pendingReads.delete(data.reqId);
      resolve?.(view);
    } else if (
      data.type === "calliope.notify" &&
      typeof data.serviceId === "string" &&
      typeof data.characteristicId === "string"
    ) {
      this.notifyListeners.get(
        charKey(data.serviceId, data.characteristicId)
      )?.(view);
    }
  };

  private request(
    message: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string }> {
    const reqId = this.nextReqId++;
    return new Promise((resolve) => {
      this.pendingResults.set(reqId, resolve);
      this.post({ type: "mltrainer", ...message, reqId });
    });
  }

  /** Ask Campus for a Bluetooth link. Resolves once it is up or has failed. */
  connect() {
    return this.request({ action: "connect" });
  }

  /** Ask Campus to put a program onto the mini. */
  flash(hex: string, name: string) {
    return this.request({ action: "flash", hex, name });
  }

  /** Tell Campus what is on screen, so its connection button stays clear of MakeCode's toolbar. */
  setView(view: "trainer" | "makecode") {
    this.post({ type: "mltrainer", action: "view", view });
  }

  addStatusListener(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Reads a characteristic; an empty value when the mini does not have it. */
  read(
    serviceId: string,
    characteristicId: string,
    timeoutMs = 3000
  ): Promise<DataView> {
    const reqId = this.nextReqId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReads.delete(reqId);
        resolve(new DataView(new ArrayBuffer(0)));
      }, timeoutMs);
      this.pendingReads.set(reqId, (view) => {
        clearTimeout(timer);
        resolve(view);
      });
      this.post({ type: "calliope.read", serviceId, characteristicId, reqId });
    });
  }

  subscribe(
    serviceId: string,
    characteristicId: string,
    listener: NotifyListener
  ) {
    this.notifyListeners.set(charKey(serviceId, characteristicId), listener);
    this.post({ type: "calliope.subscribe", serviceId, characteristicId });
  }

  unsubscribe(serviceId: string, characteristicId: string) {
    this.notifyListeners.delete(charKey(serviceId, characteristicId));
    this.post({ type: "calliope.unsubscribe", serviceId, characteristicId });
  }
}

let host: CampusHost | undefined;

/** The one Campus link of this page (only in Campus mode). */
export const getCampusHost = (): CampusHost => {
  if (!host) {
    host = new CampusHost();
  }
  return host;
};
