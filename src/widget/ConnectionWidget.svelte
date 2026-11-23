<script lang="ts">
  /**
   * The connection widget on the trainer's own page, as Calliope Campus shows
   * it beside the trainer on /ki-training: the floating connection button
   * (top right, bottom right while MakeCode is on screen), the banner and the
   * dialogs the widget's connect and transfer flows wait on. See
   * connection-widget.ts.
   */
  import {
    BleOfflineModal,
    ConnectButton,
    ConnectionBanner,
    ConnectionChoiceModal,
    Mini12VersionModal,
    Mini2FlashFallbackModal,
    Mini2SerialOfferModal,
    UsbPlugRequestModal,
  } from "@calliope-edu/mini-connection-widget";
  import { widgetView } from "./widget-view";
</script>

<div class="floating-connect" class:bottom-right={$widgetView === "makecode"}>
  <ConnectButton appearance="icon" />
</div>

<ConnectionBanner />
<UsbPlugRequestModal />
<ConnectionChoiceModal />
<BleOfflineModal />
<Mini2FlashFallbackModal />
<Mini2SerialOfferModal />
<Mini12VersionModal />

<style>
  /* As on Campus' /ki-training: a dark chip behind the icon, so the white
     Calliope mark stays visible on the trainer's light header. Above the
     trainer's own dialogs, as the button sits outside the trainer in Campus. */
  .floating-connect {
    position: fixed;
    top: 0.5rem;
    right: 0.75rem;
    z-index: 1500;
    padding: 3px;
    border-radius: 999px;
    background: #1f2023;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
  }

  /* Above MakeCode's zoom buttons and scroll bar, over the empty workspace. */
  .floating-connect.bottom-right {
    top: auto;
    bottom: 6.5rem;
    right: 2rem;
  }
</style>
