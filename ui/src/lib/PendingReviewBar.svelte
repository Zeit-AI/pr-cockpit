<script>
  // The staged-review control. Lives outside PrDetail.svelte like the rest of this fork's additions:
  // it reads the PR from the route hash rather than taking props, so PrDetail's three-line footprint
  // does not grow a fourth. Mounted from ReviewShortcut, which the tab bar renders on every tab, so
  // the bar is reachable while reading Files - which is where inline comments are written.
  import { enqueueMutation } from "./api.js";
  import { deletePendingComment, fetchPendingReview, setPendingReviewMode } from "./pendingReviewApi.js";

  const POLL_MS = 2000;

  let route = $state(readRoute());
  let state = $state(null);
  let open = $state(false);
  let composing = $state(false);
  let body = $state("");
  let busy = $state(false);
  let error = $state(null);

  // "#/pr/owner/repo/123/files" - the tab suffix is optional
  function readRoute() {
    const match = /^#\/pr\/([^/]+)\/([^/]+)\/(\d+)/.exec(location.hash);
    if (!match) return null;
    return { repo: `${match[1]}/${match[2]}`, number: Number(match[3]) };
  }

  let comments = $derived(state?.comments ?? []);
  let count = $derived(comments.length);
  let staged = $derived(state?.staged !== false);

  $effect(() => {
    function onHash() {
      const next = readRoute();
      if (next?.repo === route?.repo && next?.number === route?.number) return;
      route = next;
      state = null;
      open = false;
      composing = false;
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  });

  // Polled rather than pushed: comments are staged by PrDetail's own composer, which knows nothing
  // about this component. Two seconds is below noticing, and the query is one indexed table read.
  $effect(() => {
    const current = route;
    if (!current) return;
    let alive = true;
    async function load() {
      try {
        const next = await fetchPendingReview(current.repo, current.number);
        if (alive) state = next;
      } catch {
        // a failed poll leaves the last known state on screen rather than blanking the bar
      }
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  });

  async function toggleMode() {
    if (!route) return;
    state = await setPendingReviewMode(route.repo, route.number, !staged);
  }

  async function discard(id) {
    if (!route) return;
    state = await deletePendingComment(route.repo, route.number, id);
  }

  async function submit(event) {
    if (!route || busy) return;
    busy = true;
    error = null;
    try {
      await enqueueMutation(route.repo, route.number, { kind: "review-verdict", event, body });
      body = "";
      composing = false;
      open = false;
      state = await fetchPendingReview(route.repo, route.number);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function lineLabel(comment) {
    return comment.startLine && comment.startLine !== comment.line
      ? `${comment.startLine}-${comment.line}`
      : String(comment.line);
  }
</script>

{#if route && count > 0}
  <div class="bar">
    {#if open}
      <div class="list">
        {#each comments as comment (comment.id)}
          <div class="row">
            <div class="where">
              <span class="path">{comment.path}</span><span class="line">:{lineLabel(comment)}</span>
            </div>
            <div class="body">{comment.body}</div>
            {#if comment.failed}
              <span class="failed" title="Submit the review again to resend it">submit failed</span>
            {:else if comment.submitting}
              <span class="sending">submitting</span>
            {:else}
              <button class="drop" onclick={() => discard(comment.id)} title="Discard this comment">✕</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if composing}
      <div class="compose">
        <textarea bind:value={body} placeholder="Review summary (optional)" rows="3"></textarea>
        {#if error}<div class="error">{error}</div>{/if}
        <div class="verdicts">
          <button disabled={busy} onclick={() => submit("COMMENT")}>Comment</button>
          <button disabled={busy} onclick={() => submit("REQUEST_CHANGES")}>Request changes</button>
          <button class="approve" disabled={busy} onclick={() => submit("APPROVE")}>Approve</button>
        </div>
      </div>
    {/if}

    <div class="head">
      <button class="count" onclick={() => (open = !open)}>
        {count} staged comment{count === 1 ? "" : "s"}
      </button>
      <button class="mode" onclick={toggleMode} title={staged ? "New comments are held until you submit" : "New comments publish immediately"}>
        {staged ? "batched" : "immediate"}
      </button>
      <button class="submit" onclick={() => (composing = !composing)}>
        {composing ? "Cancel" : "Submit review"}
      </button>
    </div>
  </div>
{/if}

<style>
  .bar {
    position: fixed;
    right: 16px;
    bottom: 46px;
    z-index: 40;
    width: 380px;
    max-width: calc(100vw - 32px);
    display: flex;
    flex-direction: column;
    background: var(--panel-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow-surface);
    overflow: hidden;
    font-size: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
  }
  .head button {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    padding: 4px 8px;
    font: inherit;
    cursor: pointer;
  }
  .head button:hover { border-color: var(--border-hover); background: var(--surface-hover); }
  .count { flex: 1; text-align: left; }
  .mode { color: var(--text-dim); }
  .submit { background: var(--native-accent); border-color: var(--native-accent); color: var(--on-brand); }
  .submit:hover { background: var(--brand-hover); }
  .list { max-height: 260px; overflow-y: auto; border-bottom: 1px solid var(--border); }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .row:last-child { border-bottom: none; }
  .where { font-family: var(--mono); font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .line { color: var(--text-faint); }
  .body { grid-column: 1 / -1; white-space: pre-wrap; color: var(--text); }
  .sending { font-size: 11px; color: var(--text-faint); }
  .failed { font-size: 11px; color: var(--native-red); white-space: nowrap; }
  .drop { background: none; border: none; color: var(--text-faint); cursor: pointer; padding: 0 2px; font-size: 11px; }
  .drop:hover { color: var(--native-red); }
  .compose { padding: 8px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .compose textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    padding: 6px;
    font: inherit;
  }
  .compose textarea:focus { outline: none; border-color: var(--focus-ring); }
  .verdicts { display: flex; gap: 6px; justify-content: flex-end; }
  .verdicts button {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text);
    padding: 4px 8px;
    font: inherit;
    cursor: pointer;
  }
  .verdicts button:hover:not(:disabled) { border-color: var(--border-hover); background: var(--surface-hover); }
  .verdicts button:disabled { opacity: 0.5; cursor: default; }
  .approve { color: var(--ready); }
  .error { color: var(--native-red); }
</style>
