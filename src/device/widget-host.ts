/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * The trainer on its own page (not embedded in Campus) with the connection
 * widget on that page, as Campus has it on /ki-training: the trainer runs in
 * Campus mode, and this host plays Campus' part in the page itself instead of
 * over postMessage. It loads the widget (widget/connection-widget.ts) on
 * first use, so the trainer embedded in Campus never loads it.
 */
import { CampusHost } from "./campus-host";

type Widget = typeof import("../widget/connection-widget");

export class WidgetCampusHost extends CampusHost {
  private widget: Promise<Widget>;

  constructor() {
    super();
    this.widget = import("../widget/connection-widget").then((widget) => {
      widget.startConnectionWidget((status) => this.setStatus(status));
      return widget;
    });
  }

  /** The widget's texts follow the trainer's language. */
  setLanguage(languageId: string) {
    void this.widget.then((widget) => widget.setWidgetLanguage(languageId));
  }

  async connect() {
    return (await this.widget).connectBluetooth();
  }

  async flash(hex: string, name: string) {
    return (await this.widget).flash(hex, name);
  }

  setView(view: "trainer" | "makecode") {
    void this.widget.then((widget) => widget.setWidgetView(view));
  }

  // Only a Campus room keeps the project outside the trainer.
  save() {}
  editInMakeCode() {}

  async read(serviceId: string, characteristicId: string, timeoutMs = 3000) {
    return (await this.widget).read(serviceId, characteristicId, timeoutMs);
  }

  // Subscriptions wait for the widget in the order they were made.
  subscribe(
    serviceId: string,
    characteristicId: string,
    listener: (data: DataView) => void
  ) {
    void this.widget.then((widget) =>
      widget.subscribe(serviceId, characteristicId, listener)
    );
  }

  unsubscribe(serviceId: string, characteristicId: string) {
    void this.widget.then((widget) =>
      widget.unsubscribe(serviceId, characteristicId)
    );
  }
}
