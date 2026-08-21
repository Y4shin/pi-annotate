import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Builds the Annotate editor Svelte component into a single self-contained
// JS bundle (dist/annotate.js) that client.ts inlines into htmlShell() — the
// same delivery model the project already uses for the compiled CSS bundle
// (dist/annotate.css). End users get a pre-built string; svelte is a
// devDependency only, never shipped.
//
// `lib` mode with `inlineDynamicImports` produces one file with the Svelte
// runtime inlined, so the bundle runs in the served HTML string with no
// module graph and no runtime npm dependencies.
export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      // main.ts imports Annotate.svelte and mounts it into #app. Building
      // main.ts (not the .svelte) means the IIFE actually runs the mount,
      // instead of merely exporting the component as window.Annotate.
      entry: ".pi/extensions/pi-annotate/main.ts",
      formats: ["iife"],
      name: "Annotate",
      fileName: () => "annotate.js",
    },
    outDir: ".pi/extensions/pi-annotate/dist",
    emptyOutDir: false, // keep annotate.css (built by build:css)
    minify: false, // readable; the string is inlined either way
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
