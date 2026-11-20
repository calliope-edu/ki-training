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
 *                       {type: "mltrainer", action: "save", project, model}       (room mode)
 *                       {type: "mltrainer", action: "makecode", project, model}   (room mode)
 *                       {type: "calliope.read", serviceId, characteristicId, reqId}
 *                       {type: "calliope.subscribe" | "calliope.unsubscribe", serviceId, characteristicId}
 *   campus -> trainer:  {type: "mltrainer", action: "status", ble, usb, boardVersion, flashing, program}
 *                       {type: "mltrainer", action: "result", reqId, ok, error?}
 *                       {type: "mltrainer", action: "load", project, model, name, readonly}   (room mode)
 *                       {source: "calliope-host", type: "calliope.readResult", reqId, message}
 *                       {source: "calliope-host", type: "calliope.notify", serviceId, characteristicId, message}
 * GATT messages carry their bytes base64-encoded.
 *
 * `program` is the program Campus' connection widget detected on the mini:
 * "ml-data" for the trainer's ML data program (microbit/calliope), which the
 * widget recognises over USB by its ML_INFO frame (channel 0x0200,
 * data[1] == 0x4D); "blocks" for the Blocks runtime; "unknown" for any other
 * program; null while it has not looked (no link, flashing) and from a Campus
 * that does not report it yet.
 *
 * Motion data reaches the trainer in one of two ways, through the same GATT
 * proxy (see campusConnection.ts):
 *   Bluetooth: the micro:bit accelerometer (e95d0753…) and button (e95d9882…)
 *              services of the data collection program, which the ML data
 *              program keeps.
 *   USB:       the ML data program's serial channels, addressed as
 *              `0b50XXXX-607f-4151-9091-7d008d6ffc5c` for channel 0xXXXX, as
 *              Campus maps Blocks UUIDs to channels. Campus relays every
 *              NOTIFY frame on a subscribed channel unthrottled:
 *                0x0203 MOTION  every 20 ms: X, Y, Z int16 LE in milli-g, seq (uint8)
 *                0x0210 BUTTON  on change: [button (1 = A, 2 = B), state (0/1/2)]
 *              A read of 0x0200 answers ML_INFO. Campus prefers Bluetooth when
 *              it holds both links, so the trainer reads USB channels only
 *              while Bluetooth is down. See microbit/calliope/README.md.
 *
 * Room mode (`&project=campus`): the trainer is a program of a Campus room.
 * Campus keeps its project and hands it over with `load` (null for a new
 * one); the trainer sends it back with `save` after each change, and "Edit in
 * MakeCode" sends `makecode` instead of opening MakeCode itself. The trained
 * model travels beside the project (null until trained; Campus keeps it as it
 * is), so it need not be trained again after a reload. See src/campus-room.ts.
 */
import { MakeCodeProject } from "@microbit/makecode-embed/react";
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

/**
 * True with `?simulate=campus`: the trainer runs as if embedded in Campus,
 * against a simulated Campus and ML data program (campusSimulation.ts), so
 * Campus mode can be tried without Campus or a mini.
 */
export const isCampusSimulation = (): boolean =>
  params.get("simulate") === "campus";

/** True when the trainer runs embedded in Campus, which owns the mini. */
export const isCampusMode = (): boolean =>
  isCampusSimulation() ||
  (params.get("controller") === "2" &&
    parentOrigin !== null &&
    window.parent !== window);

/** True in a Campus room, where Campus keeps the project (see src/campus-room.ts). */
export const isCampusRoomMode = (): boolean =>
  !isCampusSimulation() && isCampusMode() && params.get("project") === "campus";

export type CampusLinkStatus = "connected" | "connecting" | "disconnected";

/** The program Campus detected on the mini (see the protocol above). */
export type CampusProgram = "ml-data" | "blocks" | "unknown";

export interface CampusStatus {
  ble: CampusLinkStatus;
  usb: CampusLinkStatus;
  boardVersion: BoardVersion | null;
  flashing: boolean;
  program: CampusProgram | null;
}

export const disconnectedCampusStatus: CampusStatus = {
  ble: "disconnected",
  usb: "disconnected",
  boardVersion: null,
  flashing: false,
  program: null,
};

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
  program?: unknown;
  serviceId?: unknown;
  characteristicId?: unknown;
  message?: unknown;
  project?: unknown;
  name?: unknown;
  readonly?: unknown;
  model?: unknown;
}

/**
 * A trained model as Campus keeps it: the tf.js topology, weight specs and
 * weight data (base64), and the recording window it was trained for.
 */
export interface CampusModel {
  topology: object;
  weightSpecs: object[];
  weights: string;
  dataWindow?: unknown;
}

/** What Campus hands a room's trainer: its project, null for a new one. */
export interface CampusLoad {
  project: MakeCodeProject | null;
  model: CampusModel | null;
  name: string;
  readonly: boolean;
}

const isModel = (value: unknown): value is CampusModel => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const model = value as Record<string, unknown>;
  return (
    !!model.topology &&
    typeof model.topology === "object" &&
    Array.isArray(model.weightSpecs) &&
    typeof model.weights === "string"
  );
};

const isProject = (value: unknown): value is MakeCodeProject => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const text = (value as { text?: unknown }).text;
  return !!text && typeof text === "object";
};

const linkStatus = (value: unknown): CampusLinkStatus =>
  value === "connected" || value === "connecting" ? value : "disconnected";

const program = (value: unknown): CampusProgram | null =>
  value === "ml-data" || value === "blocks"
    ? value
    : typeof value === "string" && value
    ? "unknown"
    : null;

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
type LoadListener = (load: CampusLoad) => void;

/**
 * What a device connection needs of Campus: its status, the requests to
 * connect and flash, and the GATT proxy. CampusHost is the real one;
 * SimulatedCampusHost (campusSimulation.ts) plays Campus without hardware.
 */
export type CampusLink = Pick<
  CampusHost,
  | "status"
  | "addStatusListener"
  | "connect"
  | "flash"
  | "read"
  | "subscribe"
  | "unsubscribe"
>;

/**
 * The trainer's side of the Campus link: requests to Campus, its answers,
 * the connection status it reports and the GATT proxy.
 */
export class CampusHost {
  status: CampusStatus = disconnectedCampusStatus;
  private nextReqId = 1;
  private pendingResults = new Map<
    number,
    (result: { ok: boolean; error?: string }) => void
  >();
  private pendingReads = new Map<number, (data: DataView) => void>();
  private statusListeners = new Set<StatusListener>();
  private notifyListeners = new Map<string, NotifyListener>();
  private loadListener: LoadListener | undefined;
  // `load` may come before the app is ready for it.
  private pendingLoad: CampusLoad | undefined;

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
        this.setStatus({
          ble: linkStatus(data.ble),
          usb: linkStatus(data.usb),
          boardVersion:
            data.boardVersion === "V1" || data.boardVersion === "V2"
              ? data.boardVersion
              : null,
          flashing: data.flashing === true,
          program: program(data.program),
        });
      } else if (data.action === "load") {
        const load: CampusLoad = {
          project: isProject(data.project) ? data.project : null,
          model: isModel(data.model) ? data.model : null,
          name: typeof data.name === "string" ? data.name : "",
          readonly: data.readonly === true,
        };
        if (this.loadListener) {
          this.loadListener(load);
        } else {
          this.pendingLoad = load;
        }
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

  protected setStatus(status: CampusStatus) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(this.status));
  }

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

  /** Hand the room's project back to Campus, which keeps it. */
  save(project: MakeCodeProject, model: CampusModel | null) {
    this.post({ type: "mltrainer", action: "save", project, model });
  }

  /** "Edit in MakeCode" in a room: Campus opens the room's MakeCode program for it. */
  editInMakeCode(project: MakeCodeProject, model: CampusModel | null) {
    this.post({ type: "mltrainer", action: "makecode", project, model });
  }

  /** Called with each project Campus hands over, including one that came already. */
  setLoadListener(listener: LoadListener) {
    this.loadListener = listener;
    const pending = this.pendingLoad;
    this.pendingLoad = undefined;
    if (pending) {
      listener(pending);
    }
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

/** Makes `simulated` the page's Campus link (see campusSimulation.ts). */
export const installCampusHost = (simulated: CampusHost) => {
  host = simulated;
};
