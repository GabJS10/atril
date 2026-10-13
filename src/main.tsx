import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createQueryClient } from "./api/queries";
import "./index.css";
import { createAppRouter } from "./router";
import { bootSpike } from "./spike/display/boot";

const router = createAppRouter();
const queryClient = createQueryClient();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App router={router} queryClient={queryClient} />
  </StrictMode>,
);

// SPIKE R0.2 (desechable): solo navega si ATRIL_SPIKE_PAGES está definido.
void bootSpike(router);
