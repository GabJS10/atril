import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createQueryClient } from "./api/queries";
import { markPlatform } from "./browserDefaults";
import "./index.css";
import { createAppRouter } from "./router";

markPlatform(document.documentElement, navigator.userAgent);

const router = createAppRouter();
const queryClient = createQueryClient();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App router={router} queryClient={queryClient} />
  </StrictMode>,
);
