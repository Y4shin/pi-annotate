import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The Svelte plugin is needed so vitest can transform .svelte imports
// (Annotate.svelte) when client.test.ts mounts the real component in
// happy-dom. compilerOptions.generate = "client" forces the client build
// (mount() is unavailable in the server build). The default
// `environment: "node"` is kept for the non-UI test files; client.test.ts
// opts into happy-dom via a per-file `// @vitest-environment happy-dom`.
export default defineConfig({
  plugins: [svelte({ compilerOptions: { generate: "client" } })],
  // Force the browser (client) entry points of svelte when running under
  // vitest, so mount() resolves to the client build instead of the server
  // build (which throws `mount(...) is not available on the server`).
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
  },
});
