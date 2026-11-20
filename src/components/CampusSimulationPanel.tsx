/**
 * (c) 2026, Calliope gGmbH.
 *
 * SPDX-License-Identifier: MIT
 *
 * Controls for the simulated Campus (`?simulate=campus`, see
 * device/campusSimulation.ts): plug the mini in over USB, connect it over
 * Bluetooth, change the program on it, move it and press its buttons. A
 * developer tool, so not translated.
 */
import {
  Box,
  Button,
  ButtonGroup,
  HStack,
  Select,
  Switch,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ConnectionStatus } from "@microbit/microbit-connection";
import { useEffect, useState } from "react";
import { useCampusStatus } from "../campus-connection-hooks";
import { CampusProgram } from "../device/campus-host";
import { getCampusConnection } from "../device/campusConnection";
import {
  getCampusSimulation,
  SimulatedMotion,
} from "../device/campusSimulation";

const programs: { value: string; label: string }[] = [
  { value: "ml-data", label: "ML data program" },
  { value: "blocks", label: "Blocks runtime" },
  { value: "unknown", label: "Another program" },
  { value: "none", label: "Nothing" },
];

const motions: { value: SimulatedMotion; label: string }[] = [
  { value: "still", label: "Still" },
  { value: "shake", label: "Shake" },
  { value: "circle", label: "Circle" },
];

const useTrainerLink = () => {
  const connection = getCampusConnection();
  // The connection moves between links without a status event, so look
  // again now and then.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 250);
    return () => clearInterval(timer);
  }, []);
  return connection.status === ConnectionStatus.CONNECTED
    ? connection.streamingOver === "usb"
      ? "reads over USB"
      : connection.streamingOver === "ble"
      ? "reads over Bluetooth"
      : "connected"
    : connection.status === ConnectionStatus.CONNECTING
    ? "connecting…"
    : "not reading";
};

const CampusSimulationPanel = () => {
  const simulation = getCampusSimulation();
  const status = useCampusStatus();
  const trainerLink = useTrainerLink();
  const [motion, setMotion] = useState<SimulatedMotion>(
    simulation?.program.motion ?? "still"
  );
  const [open, setOpen] = useState(true);
  if (!simulation) {
    return null;
  }
  const { usb, ble } = simulation.links;
  const program = simulation.currentProgram ?? "none";
  return (
    <Box
      position="fixed"
      top="72px"
      right="12px"
      zIndex={1500}
      bg="white"
      borderWidth={1}
      borderColor="gray.300"
      borderRadius="md"
      boxShadow="md"
      p={3}
      w="240px"
      fontSize="sm"
      data-testid="campus-simulation"
    >
      <HStack justifyContent="space-between">
        <Text fontWeight="bold">Simulated Campus</Text>
        <Button size="xs" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"}
        </Button>
      </HStack>
      {open && (
        <VStack alignItems="stretch" gap={2} mt={2}>
          <HStack justifyContent="space-between">
            <Text>USB cable</Text>
            <Switch
              isChecked={usb}
              onChange={(e) => simulation.setLinks({ usb: e.target.checked })}
              aria-label="USB cable"
            />
          </HStack>
          <HStack justifyContent="space-between">
            <Text>Bluetooth</Text>
            <Switch
              isChecked={ble}
              onChange={(e) => simulation.setLinks({ ble: e.target.checked })}
              aria-label="Bluetooth"
            />
          </HStack>
          <Select
            size="sm"
            value={program}
            aria-label="Program on the mini"
            onChange={(e) =>
              simulation.setProgram(
                e.target.value === "none"
                  ? null
                  : (e.target.value as CampusProgram)
              )
            }
          >
            {programs.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <ButtonGroup size="xs" isAttached variant="outline">
            {motions.map((m) => (
              <Button
                key={m.value}
                flex={1}
                isActive={motion === m.value}
                onClick={() => {
                  simulation.program.motion = m.value;
                  setMotion(m.value);
                }}
              >
                {m.label}
              </Button>
            ))}
          </ButtonGroup>
          <HStack>
            <Button
              size="xs"
              flex={1}
              onClick={() => simulation.program.press("A")}
            >
              A
            </Button>
            <Button
              size="xs"
              flex={1}
              onClick={() => simulation.program.press("B")}
            >
              B
            </Button>
            <Button
              size="xs"
              flex={2}
              onClick={() => simulation.program.press("A", 2000)}
            >
              Hold A
            </Button>
          </HStack>
          <Text color="gray.600" fontSize="xs">
            Campus: {status.flashing ? "flashing… " : ""}
            {status.program
              ? `${status.program} detected`
              : "no program detected"}
            <br />
            Trainer: {trainerLink}
          </Text>
        </VStack>
      )}
    </Box>
  );
};

export default CampusSimulationPanel;
