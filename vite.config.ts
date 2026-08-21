import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Two modes from this one config:
//   - `npm run build:svelte` (vite build): compiles the Annotate editor Svelte
//     component into a single self-contained IIFE bundle (dist/annotate.js)
//     that client.ts inlines into htmlShell() — the same delivery model the
//     project already uses for the compiled CSS bundle. svelte is a
//     devDependency only; end users get a pre-built string, no runtime deps.
//   - `npm run live` (vite): dev server serving live/index.html, which mounts
//     the SAME Annotate.svelte component so Impeccable live's component-preview
//     mode (gated on the .svelte extension) can wrap and mount variants against
//     the real component source.
//
// The dev server keeps the project root (so the build entry, the extension's
// compiled CSS, and the sample doc all resolve); live/index.html is served at
// /live/index.html and `npm run live` opens it.
export default defineConfig({
  plugins: [svelte()],
  server: {
    host: "127.0.0.1",
    // Random free port by default (bind to 0); pin with PORT=…
    port: Number(process.env.PORT) || 0,
    strictPort: false,
    open: "/live/index.html",
  },
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
