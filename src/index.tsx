import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";

const container = document.getElementById("root") as HTMLElement;
const root = createRoot(container);

async function enableMocks() {
  if (!import.meta.env.DEV) return;
  if (import.meta.env.VITE_ENABLE_MSW !== "true") return;

  try {
    const { worker } = await import("./mocks/browser");
    await worker.start({
      onUnhandledRequest: "bypass",
    });
  } catch (e) {
    // Keep the app usable even if MSW isn't initialized yet (e.g. missing mockServiceWorker.js).
    // eslint-disable-next-line no-console
    console.warn("MSW failed to start:", e);
  }
}

enableMocks().then(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
