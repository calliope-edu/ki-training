/**
 * (c) 2024, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import App from "./App";
import ReactDOM from "react-dom/client";
import { logBuildInfoWhenEmbedded } from "./build-info";

logBuildInfoWhenEmbedded();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
