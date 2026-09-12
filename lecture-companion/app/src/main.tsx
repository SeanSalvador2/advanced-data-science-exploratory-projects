import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./styles/tokens.css";
import "./styles/text-layer.css";

const host = document.getElementById("root");
if (!host) throw new Error("index.html has no #root element");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
