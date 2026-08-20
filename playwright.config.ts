import { defineConfig } from "@playwright/test";

// E2E tests drive the real built preview (dist/preview.html) in a real
// browser via Playwright. The browsers themselves are provided by Nix
// (see flake.nix devShell), so `playwright install` is never run here.
export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    // The preview is a static file that renders via a fetch shim, so it works
    // headless and on file://. Real Chromium from the Nix shell.
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
