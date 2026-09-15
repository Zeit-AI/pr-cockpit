<script>
  let { state, onRetry, onDiscard, pendingLabel = "POSTING…" } = $props();
</script>

{#if state === "pending"}
  <span class="badge wait">{pendingLabel}</span>
{:else if state === "staged"}
  <!-- written but deliberately not sent: it goes out with the rest of the review, not on its own -->
  <span class="badge staged">STAGED</span>
  <button class="link" onclick={onDiscard}>Discard</button>
{:else if state === "submit-failed"}
  <!-- the review it rides in failed; the verdict owns the retry, so no buttons here -->
  <span class="badge fail">REVIEW NOT SENT</span>
{:else if state === "failed"}
  <span class="badge fail">FAILED</span>
  <button class="link" onclick={onRetry}>Retry</button>
  <button class="link" onclick={onDiscard}>Discard</button>
{/if}

<style>
  .badge.staged {
    background: color-mix(in srgb, var(--native-orange) 16%, transparent);
    color: var(--native-orange);
  }
  .link {
    background: none;
    border: none;
    color: var(--text-dim);
    font-family: var(--sans);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }
  .link:hover {
    color: var(--text);
  }
</style>
