import { defineConfig, devices } from "@playwright/test";

import { BASE_URL, VAULT } from "./e2e/paths.ts";

/**
 * Chromium only, one worker. The tests share one vault on disk and several of
 * them assert on the exact contents of `events.jsonl`, so they must not run
 * against each other.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      // The viewport comes last: the device preset carries one of its own.
      // ui-direction.md §C sizes the screens for Chrome windowed on a MacBook
      // Air at its default scaling.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1470, height: 852 } },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { LECTURE_DEV_ROOT: VAULT },
  },
});
