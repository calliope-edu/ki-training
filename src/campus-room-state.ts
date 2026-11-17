/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 */
import { create } from "zustand";
import { isCampusRoomMode } from "./device/campus-host";

/**
 * Where a Campus room's trainer stands (src/campus-room.ts). Outside a room
 * it is loaded and editable from the start.
 */
export interface CampusRoomState {
  /** Campus has handed over the project and the trainer shows it. */
  loaded: boolean;
  /** A teacher looking at a student's KI-Training: nothing changes, nothing is saved. */
  readonly: boolean;
}

export const useCampusRoomState = create<CampusRoomState>()(() => ({
  loaded: !isCampusRoomMode(),
  readonly: false,
}));

export const isReadonly = (): boolean => useCampusRoomState.getState().readonly;

export const useIsReadonly = (): boolean =>
  useCampusRoomState((s) => s.readonly);
