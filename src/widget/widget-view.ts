/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 */
import { writable } from "svelte/store";

/**
 * What the trainer shows: its own pages, or MakeCode, whose toolbar fills the
 * top right, so the connection button moves to the bottom right there.
 */
export const widgetView = writable<"trainer" | "makecode">("trainer");
