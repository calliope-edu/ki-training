/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * Room mode: the trainer is a KI-Training program of a Calliope Campus room
 * (`?controller=2&parentOrigin=<campus>&project=campus`). Campus keeps the
 * project, one per program, so neither the start page nor the browser's
 * storage play a part:
 * - The trainer waits for `load` and opens what it gets: the project as it
 *   saved it last, with its trained model, or a new session when there is
 *   none yet.
 * - After each change it hands the project back (`save`, debounced).
 * - "Edit in MakeCode" asks Campus to open the room's MakeCode program for
 *   it (`makecode`); Campus keeps that program's model in step.
 * - Read-only (a teacher looking at a student's KI-Training) it shows the
 *   project but changes and saves nothing.
 * Protocol in src/device/campus-host.ts.
 */
import * as tf from "@tensorflow/tfjs";
import { MakeCodeProject } from "@microbit/makecode-embed/react";
import debounce from "lodash.debounce";
import { useCampusRoomState } from "./campus-room-state";
import { CampusLoad, CampusModel, getCampusHost } from "./device/campus-host";
import { filenames } from "./makecode/utils";
import { DataWindow, getProjectWithCurrentFiles, useStore } from "./store";

const saveDelayMs = 1000;

// A model is serialized once, however often the project is saved with it.
const serializedModels = new WeakMap<tf.LayersModel, Promise<CampusModel>>();

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const base64ToBuffer = (b64: string): ArrayBuffer => {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes.buffer;
};

const serializeModel = (
  model: tf.LayersModel,
  dataWindow: DataWindow
): Promise<CampusModel> => {
  let serialized = serializedModels.get(model);
  if (!serialized) {
    serialized = new Promise<CampusModel>((resolve, reject) => {
      model
        .save(
          tf.io.withSaveHandler((artifacts) => {
            resolve({
              topology: artifacts.modelTopology as object,
              weightSpecs: artifacts.weightSpecs ?? [],
              weights: bytesToBase64(
                new Uint8Array(
                  tf.io.CompositeArrayBuffer.join(
                    artifacts.weightData ?? new ArrayBuffer(0)
                  )
                )
              ),
              dataWindow,
            });
            return Promise.resolve({
              modelArtifactsInfo: {
                dateSaved: new Date(),
                modelTopologyType: "JSON",
              },
            });
          })
        )
        .catch(reject);
    });
    serializedModels.set(model, serialized);
  }
  return serialized;
};

const restoreModel = async (
  model: CampusModel
): Promise<tf.LayersModel | undefined> => {
  try {
    const restored = await tf.loadLayersModel(
      tf.io.fromMemory({
        modelTopology: model.topology,
        weightSpecs: model.weightSpecs as tf.io.WeightsManifestEntry[],
        weightData: base64ToBuffer(model.weights),
      })
    );
    // Serializing it again gives what Campus has already.
    serializedModels.set(restored, Promise.resolve(model));
    return restored;
  } catch (e) {
    console.warn("[campus-room] Could not restore the model", e);
    return undefined;
  }
};

const isDataWindow = (value: unknown): value is DataWindow => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const w = value as Record<string, unknown>;
  return (
    typeof w.duration === "number" &&
    typeof w.minSamples === "number" &&
    typeof w.deviceSamplesPeriod === "number" &&
    typeof w.deviceSamplesLength === "number"
  );
};

/** The project and model as Campus keeps them. */
const currentProject = async (): Promise<{
  project: MakeCodeProject;
  model: CampusModel | null;
}> => {
  const { model, dataWindow } = useStore.getState();
  const project = getProjectWithCurrentFiles();
  let serialized: CampusModel | null = null;
  if (model) {
    try {
      serialized = await serializeModel(model, dataWindow);
    } catch (e) {
      // Saved without it, the model is trained again on the next load.
      console.warn("[campus-room] Could not serialize the model", e);
    }
  }
  return { project, model: serialized };
};

// What Campus has, to save only what changed.
let lastSaved: string | undefined;

const save = async () => {
  if (useCampusRoomState.getState().readonly) {
    return;
  }
  const { project, model } = await currentProject();
  const json = JSON.stringify({ project, model });
  if (json === lastSaved) {
    return;
  }
  lastSaved = json;
  getCampusHost().save(project, model);
};

const scheduleSave = debounce(() => void save(), saveDelayMs);

/** "Edit in MakeCode" in a room: Campus opens the room's MakeCode program. */
export const editInMakeCodeProgram = async () => {
  if (useCampusRoomState.getState().readonly) {
    return;
  }
  scheduleSave.cancel();
  await save();
  const { project, model } = await currentProject();
  getCampusHost().editInMakeCode(project, model);
};

const load = async ({ project, model, name, readonly }: CampusLoad) => {
  scheduleSave.cancel();
  useCampusRoomState.setState({ loaded: false, readonly });
  const restored = model ? await restoreModel(model) : undefined;
  const dataWindow =
    restored && model && isDataWindow(model.dataWindow)
      ? model.dataWindow
      : undefined;
  useStore
    .getState()
    .loadCampusProject(project, name, restored, restored && dataWindow);
  // What Campus has now: a change made before it is saved compares to it.
  const current = await currentProject();
  lastSaved =
    project && (restored || !model)
      ? JSON.stringify(current)
      : // A new KI-Training is saved at once, so Campus has its project; one
        // whose model could not be restored is saved once trained again.
        undefined;
  useCampusRoomState.setState({ loaded: true, readonly });

  if (!readonly && !project) {
    void save();
  }
  // Trained before, but the model did not come along (saved before Campus
  // kept models, or lost): train it again from the recorded data.
  const wasTrained = !!project?.text?.[filenames.autogenerated]?.trim();
  if (!restored && wasTrained && !readonly) {
    const { actions, trainModel } = useStore.getState();
    if (actions.length >= 2 && actions.every((a) => a.recordings.length >= 3)) {
      await trainModel();
    }
  }
};

/** Starts room mode: called once, before the app renders. */
export const startCampusRoom = () => {
  useStore.subscribe((state, prev) => {
    const { loaded, readonly } = useCampusRoomState.getState();
    if (!loaded || readonly) {
      return;
    }
    if (
      state.actions !== prev.actions ||
      state.model !== prev.model ||
      state.project !== prev.project ||
      state.dataWindow !== prev.dataWindow
    ) {
      scheduleSave();
    }
  });
  getCampusHost().setLoadListener((data) => void load(data));
};
