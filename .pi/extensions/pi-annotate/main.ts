// Entry point for both the production build (Vite lib → dist/annotate.js) and
// the Vite dev server (live preview). Mounts the Annotate editor into #app.
//
// In the built bundle (IIFE) this runs automatically when inlined by
// htmlShell(). In the dev server it is loaded as a module by index.html.
import { mount } from "svelte";
import Annotate from "./Annotate.svelte";

const target = document.getElementById("app");
if (target) {
  mount(Annotate, { target });
}
