/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 */
import { Flex } from "@chakra-ui/react";
import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useCampusRoomState } from "../campus-room-state";
import { isCampusRoomMode } from "../device/campus-host";
import { createDataSamplesPageUrl, createTestingModelPageUrl } from "../urls";
import LoadingAnimation from "./LoadingAnimation";

// The pages of a room's project. The start pages and MakeCode belong to
// Campus there.
const roomPages = [createDataSamplesPageUrl(), createTestingModelPageUrl()];

/**
 * In a Campus room (src/campus-room.ts) the pages wait for the project Campus
 * hands over, which opens on the data samples page.
 */
const CampusRoomGate = ({ children }: { children: ReactNode }) => {
  const loaded = useCampusRoomState((s) => s.loaded);
  const { pathname } = useLocation();
  if (!isCampusRoomMode()) {
    return <>{children}</>;
  }
  if (!loaded) {
    return (
      <Flex h="100vh" alignItems="center" justifyContent="center">
        <LoadingAnimation />
      </Flex>
    );
  }
  if (!roomPages.includes(pathname)) {
    return <Navigate to={createDataSamplesPageUrl()} replace />;
  }
  return <>{children}</>;
};

export default CampusRoomGate;
