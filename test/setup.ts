// Global test setup. Runs once before the test suite.
//
// The pi-annotate extension opens a browser in real operation (the `annotate`
// tool and `/annotate` command both pass `openBrowser: true`, which spawns
// `xdg-open`/`open`/`start`). Opening a browser from a test is never desired —
// it steals focus on the dev machine and does nothing useful in CI. The
// server already honors `PI_ANNOTATE_NO_BROWSER=1` (see server.ts openBrowser)
// and most tests pass `openBrowser: false`, but set the env var globally here
// as a belt-and-suspenders guard so no test can ever spawn a browser process
// even if it forgets the per-call flag. Real operation is unaffected: the
// extension's own entry points do not run under vitest.
process.env.PI_ANNOTATE_NO_BROWSER = "1";
