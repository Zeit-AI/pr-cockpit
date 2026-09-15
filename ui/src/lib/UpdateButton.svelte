<script>
  import { checkForUpdates, fetchVersion, triggerUpdate } from "./api.js";
  import { showFlash } from "./flash.svelte.js";
  import { pollIntervalMs, updateOutcome } from "./updateProgress.js";

  let { manual = false } = $props();
  let checking = $state(false);
  let checkMessage = $state("");

  async function check() {
    if (checking || updating) return;
    checking = true;
    checkMessage = "";
    available = false;
    try {
      const result = await checkForUpdates();
      if (result.rev && loadedRev === null) loadedRev = result.rev;
      available = result.updateAvailable;
      checkMessage = available ? "Update available." : "Already up to date.";
    } catch (err) {
      checkMessage = `Update check failed: ${err.message}`;
    } finally {
      checking = false;
    }
  }
  let available = $state(false);
  let updating = $state(false);
  // The build this page was served by. An update that restarts the server without replacing this window
  // leaves the old bundle on screen, so the page reloads itself once the server reports a new revision.
  let loadedRev = null;

  async function poll() {
    try {
      const { updateAvailable, rev } = await fetchVersion();
      available = updateAvailable;
      const outcome = updateOutcome({ rev, loadedRev, updateAvailable, updating });
      if (loadedRev === null && rev) loadedRev = rev;
      // new build on disk: reload so the window stops running the bundle it was served
      if (outcome === "reload") location.reload();
      else if (outcome === "settled") {
        updating = false;
        showFlash("Already up to date.");
      }
    } catch {
      // the server is mid-restart; the next tick picks it back up
    }
  }

  // While an update is running the server is being restarted underneath us, so poll at a rate that
  // notices it coming back. Idle polling stays slow: it only has to catch someone else's push.
  $effect(() => {
    if (manual && !updating) return;
    poll();
    const timer = setInterval(poll, pollIntervalMs({ updating, manual }));
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (manual) return;
    function onVisible() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  });

  async function update() {
    if (updating) return;
    updating = true;
    try {
      await triggerUpdate();
      // Backstop only. The poll above normally ends the progress state by reloading the window or by
      // reporting that there was nothing to pull; this catches an update that never comes back.
      setTimeout(() => {
        if (!updating) return;
        updating = false;
        showFlash("Update is taking longer than expected — check the app again in a moment.");
      }, 60000);
    } catch (err) {
      updating = false;
      showFlash(`Update failed: ${err.message}`);
    }
  }
</script>

{#if manual}
  <button class="update" type="button" disabled={checking || updating} onclick={check}>
    {checking ? "Checking…" : "Check for updates"}
  </button>
  <span role="status">{checkMessage}</span>
{/if}
{#if available}
  <button class="update" class:updating disabled={updating} aria-label={updating ? "Updating" : "Install update"} onclick={update}>
    {updating ? "Updating…" : "Install update"}
  </button>
{/if}

<style>
  .update {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--sans);
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--link);
    background: var(--link-bg);
    border: 1px solid var(--link);
    border-radius: 6px;
    padding: 3px 9px;
    cursor: pointer;
  }
  .update::before {
    content: "↑";
    font-size: 12px;
  }
  .update:hover:not(:disabled) {
    background: var(--link-bg-hover);
  }
  .update:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .update:focus-visible {
    outline: 2px solid var(--link);
    outline-offset: 2px;
  }

  .update {
    min-height: 32px;
    padding: 0 12px;
    font-family: var(--sans);
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    letter-spacing: 0;
    box-shadow: none;
    border-color: transparent;
    border-radius: 999px;
    transition: background-color 140ms ease, transform 140ms var(--ease-out);
  }
  .update:active:not(:disabled) {
    transform: scale(0.99);
  }
</style>
