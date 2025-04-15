import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
// import "@wbcnc/ui/globals.css"

import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "@wbcnc/ui/components/theme-provider";
import { routeTree } from "./routeTree.gen";

// Set up a Router instance
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPendingComponent: () => <div>Loading...</div>,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>
);
