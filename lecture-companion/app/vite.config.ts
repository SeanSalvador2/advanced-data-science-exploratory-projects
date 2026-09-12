import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { devFolderPlugin } from "./vite-plugin-dev-folder.ts";

export default defineConfig({
  plugins: [react(), devFolderPlugin()],
  server: {
    port: 5175,
    strictPort: true,
  },
  build: {
    // The dev adapter is behind `import.meta.env.DEV`; keeping the build free
    // of dead branches is what lets `scripts/check-bundle.mjs` prove it is gone.
    target: "es2022",
    sourcemap: false,
  },
  worker: {
    format: "es",
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
  },
});
