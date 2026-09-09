<script>
  import { checkForUpdates, fetchVersion, triggerUpdate } from "./api.js";
  import { showFlash } from "./flash.svelte.js";

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
      if (!rev) return;
      if (loadedRev === null) loadedRev = rev;
      else if (rev !== loadedRev) location.reload();
    } catch {}
  }

  $effect(() => {
    if (manual && !updating) return;
    poll();
    const timer = setInterval(poll, manual ? 1000 : 5 * 60 * 1000);
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
      setTimeout(() => (updating = false), 60000);
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
