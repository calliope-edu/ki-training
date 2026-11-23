/**
 * (c) 2024, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
} from "@chakra-ui/react";
import { ComponentProps, useCallback, useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { useCampusStatus } from "../campus-connection-hooks";
import { ConnectionStatus } from "../connect-status-hooks";
import { useConnectionStage } from "../connection-stage-hooks";
import { isCampusMode } from "../device/campus-host";
import { ConnectOptions } from "../store";
import { ButtonWithLoading } from "./ButtonWithLoading";

interface ConnectFirstDialogProps
  extends Omit<ComponentProps<typeof Modal>, "children"> {
  explanationTextId: string;
  onChooseConnect?: () => void;
  options?: ConnectOptions;
}

const ConnectFirstDialog = ({
  explanationTextId,
  options,
  onClose,
  onChooseConnect,
  isOpen,
  ...rest
}: ConnectFirstDialogProps) => {
  const {
    actions,
    status: connStatus,
    isDialogOpen: isConnectionDialogOpen,
  } = useConnectionStage();
  const [isWaiting, setIsWaiting] = useState<boolean>(false);
  const intl = useIntl();

  // In Campus a mini the widget holds is not "not connected": the action
  // transfers the ML data program instead, which Campus does over USB only
  // (over Bluetooth in its debug mode alone). As in the live graph panel, a
  // mini on Bluetooth only gets a hint to plug in the cable, not the action.
  const campus = useCampusStatus();
  const isCampus = isCampusMode();
  const campusUsb = isCampus && campus.usb === "connected";
  const campusBleOnly = isCampus && !campusUsb && campus.ble === "connected";
  const [titleId, bodyId] = !isCampus
    ? ["microbit-not-connected", explanationTextId]
    : campus.ble === "connected"
    ? [
        "campus-microbit-ble-connected",
        campusUsb ? "campus-connect-needs-program" : "campus-connect-needs-usb",
      ]
    : campusUsb
    ? ["campus-microbit-usb-connected", "campus-connect-needs-program"]
    : ["microbit-not-connected", explanationTextId];
  const actionId = campusUsb
    ? "campus-transfer-program-action"
    : "connect-action";

  const handleOnClose = useCallback(() => {
    setIsWaiting(false);
    onClose();
  }, [onClose]);

  const handleConnect = useCallback(async () => {
    onChooseConnect?.();
    switch (connStatus) {
      case ConnectionStatus.FailedToConnect:
      case ConnectionStatus.FailedToReconnectTwice:
      case ConnectionStatus.FailedToSelectBluetoothDevice:
      case ConnectionStatus.NotConnected: {
        // Start connection flow.
        actions.startConnect(options);
        return handleOnClose();
      }
      case ConnectionStatus.ConnectionLost:
      case ConnectionStatus.FailedToReconnect:
      case ConnectionStatus.Disconnected: {
        // Reconnect.
        await actions.reconnect();
        return handleOnClose();
      }
      case ConnectionStatus.ReconnectingAutomatically: {
        // Wait for reconnection to happen.
        setIsWaiting(true);
        return;
      }
      case ConnectionStatus.Connected: {
        // Connected whilst dialog is up.
        return handleOnClose();
      }
      case ConnectionStatus.ReconnectingExplicitly:
      case ConnectionStatus.Connecting: {
        // Impossible cases.
        return handleOnClose();
      }
    }
  }, [onChooseConnect, connStatus, actions, options, handleOnClose]);

  useEffect(() => {
    if (
      isOpen &&
      (isConnectionDialogOpen ||
        (isWaiting && connStatus === ConnectionStatus.Connected))
    ) {
      // Close dialog if connection dialog is opened, or
      // once connected after waiting.
      handleOnClose();
      return;
    }
  }, [
    connStatus,
    handleOnClose,
    isConnectionDialogOpen,
    isOpen,
    isWaiting,
    onClose,
  ]);

  return (
    <Modal
      closeOnOverlayClick={false}
      motionPreset="none"
      size="md"
      isCentered
      onClose={handleOnClose}
      isOpen={isOpen}
      {...rest}
    >
      <ModalOverlay>
        <ModalContent>
          <ModalHeader>
            <FormattedMessage id={titleId} />
          </ModalHeader>
          <ModalBody>
            <ModalCloseButton />
            <Text>
              <FormattedMessage id={bodyId} />
            </Text>
          </ModalBody>
          <ModalFooter justifyContent="flex-end">
            {campusBleOnly ? (
              <Button variant="primary" onClick={handleOnClose}>
                <FormattedMessage id="close-action" />
              </Button>
            ) : (
              <ButtonWithLoading
                variant="primary"
                onClick={handleConnect}
                isLoading={isWaiting}
                aria-label={
                  campusUsb
                    ? intl.formatMessage({
                        id: "campus-transfer-program-action-aria",
                      })
                    : undefined
                }
              >
                <FormattedMessage id={actionId} />
              </ButtonWithLoading>
            )}
          </ModalFooter>
        </ModalContent>
      </ModalOverlay>
    </Modal>
  );
};

export default ConnectFirstDialog;
