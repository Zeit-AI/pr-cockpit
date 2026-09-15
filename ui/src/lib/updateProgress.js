// The update button's decision logic, kept out of the component so it can be tested. The window that
// triggers an update is served by the build being replaced: the server restarts underneath it, and
// nothing pushes the result back, so the button only learns what happened by asking again.

const IDLE_POLL_MS = 5 * 60 * 1000;
const ACTIVE_POLL_MS = 1000;

// Idle polling only has to notice someone else's push, so it stays slow. While an update is running,
// or while the Settings control is waiting on a manual check, poll fast enough to catch the server
// coming back - otherwise the button sits stale long after the work finished.
export function pollIntervalMs({ updating = false, manual = false } = {}) {
  return updating || manual ? ACTIVE_POLL_MS : IDLE_POLL_MS;
}

// What the button should do with a version response.
//
// "reload"  - the server is serving a different revision than this window was, so the page is stale.
// "settled" - the update finished with nothing to pull: same revision, no update outstanding. No
//             reload is coming, so the button has to resolve itself or it silently returns to
//             "Install update" with no way to tell whether the click did anything.
// "wait"    - nothing conclusive yet.
export function updateOutcome({ rev, loadedRev, updateAvailable, updating }) {
  if (!rev) return "wait";
  if (loadedRev !== null && rev !== loadedRev) return "reload";
  if (updating && !updateAvailable) return "settled";
  return "wait";
}
