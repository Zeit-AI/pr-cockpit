<script>
  import Kbd from "./Kbd.svelte";
  import { askReview, fetchReviewState } from "./api.js";
  import { renderMarkdown } from "./markdown.js";
  import { relativeTime } from "./time.js";
  import { REVIEW_PROMPTS } from "./reviewPrompts.js";

  let { repo, number } = $props();

  // the PR view's fixed key bar overlaps the very bottom of the page
  const BOTTOM_GUTTER = 34;

  let state = $state(null);
  let loadError = $state(null);
  let draft = $state("");
  let sending = $state(false);
  let sendError = $state(null);
  let input = $state(null);
  let log = $state(null);
  let root = $state(null);
  let height = $state(null);

  let turns = $derived(state?.turns ?? []);
  let busy = $derived(sending || state?.running === true);
  // cache-busted so a rewritten page is actually re-fetched rather than served from the iframe's memory
  let htmlSrc = $derived(
    state?.htmlExists ? `/review/${repo}/${number}/index.html?v=${encodeURIComponent(state.htmlUpdatedAt ?? "")}` : null,
  );

  async function load() {
    try {
      state = await fetchReviewState(repo, number);
      loadError = null;
    } catch (err) {
      loadError = err.message;
    }
  }

  $effect(() => {
    repo;
    number;
    load();
  });

  // while the agent is working the answer lands in the transcript server-side, so polling is what
  // shows it - including when this tab was closed and reopened part-way through a long answer
  $effect(() => {
    if (!busy) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  });

  // The surrounding PR view flows with the page, but chat and the map each need their own scrollbar,
  // so this tab claims the rest of the viewport. Measured rather than hard-coded: the header and tab
  // bar above it change height with the PR, and PrDetail.svelte is not ours to restructure.
  $effect(() => {
    if (!root) return;
    // re-measures until it converges: the first pass runs before the header above has settled, and
    // sizing this tab is itself what removes the page scroll that shifted the measurement
    const fit = () => {
      const top = root.getBoundingClientRect().top + window.scrollY;
      const next = Math.max(360, document.documentElement.clientHeight - top - BOTTOM_GUTTER);
      if (height === null || Math.abs(next - height) > 1) height = next;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(document.body);
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit);
    };
  });

  // keep the newest turn in view as the conversation grows
  $effect(() => {
    turns.length;
    busy;
    if (log) log.scrollTop = log.scrollHeight;
  });

  async function send(message) {
    const text = message.trim();
    if (!text || sending) return;
    sending = true;
    sendError = null;
    draft = "";
    await load();
    try {
      await askReview(repo, number, text);
    } catch (err) {
      sendError = err.message;
    } finally {
      sending = false;
      await load();
    }
  }

  function onKey(event) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send(draft);
    }
  }

  function usePrompt(prompt) {
    draft = prompt.message;
    input?.focus();
    send(prompt.message);
  }
</script>

<div
  class="review-layout"
  class:with-html={!!htmlSrc}
  bind:this={root}
  style:height={height === null ? null : `${height}px`}
>
  <section class="chat">
    <div class="chat-log" bind:this={log}>
      {#if loadError}
        <div class="review-empty">Couldn’t load this review: {loadError}</div>
      {:else if turns.length === 0}
        <div class="review-empty">
          Ask about this PR — the diff, or any code around it. The agent reads the whole repository at the PR head.
        </div>
      {/if}
      {#each turns as turn, i (i)}
        <article class="turn {turn.role}">
          <header>
            <span class="who">{turn.role === "user" ? "You" : "Review agent"}</span>
            <span class="when">{relativeTime(turn.at)}</span>
          </header>
          <div class="md">{@html renderMarkdown(turn.text)}</div>
        </article>
      {/each}
      {#if busy}
        <div class="thinking">Reading the repository…</div>
      {/if}
    </div>

    {#if sendError}<div class="send-error">{sendError}</div>{/if}

    <div class="composer">
      <div class="prompt-templates">
        {#each REVIEW_PROMPTS as prompt (prompt.label)}
          <button class="template" disabled={busy} onclick={() => usePrompt(prompt)}>{prompt.label}</button>
        {/each}
      </div>
      <textarea
        bind:this={input}
        bind:value={draft}
        onkeydown={onKey}
        rows="3"
        placeholder="Ask about this PR…"
      ></textarea>
      <div class="composer-actions">
        {#if state?.model}<span class="composer-hint">{state.model}</span>{/if}
        <button class="send" disabled={busy || !draft.trim()} onclick={() => send(draft)}>
          {busy ? "Thinking…" : "Send"} {#if !busy && draft.trim()}<Kbd keys={["cmd", "enter"]} />{/if}
        </button>
      </div>
    </div>
  </section>

  {#if htmlSrc}
    <section class="html-pane">
      <header class="html-head">
        <span class="html-title">Visual overview</span>
        {#if state.stale}
          <span class="stale" title="Built against {state.htmlHeadSha?.slice(0, 7)}, the PR is now at {state.headSha?.slice(0, 7)}">
            stale — built against an older head
          </span>
        {/if}
        <a class="html-open" href={htmlSrc} target="_blank" rel="noopener">open</a>
      </header>
      <iframe src={htmlSrc} sandbox="allow-scripts" title="Review overview for {repo}#{number}"></iframe>
    </section>
  {/if}
</div>

<style>
  .review-layout {
    display: flex;
    gap: 12px;
    align-items: stretch;
    /* until the measuring effect runs, a sane height rather than a collapsed or runaway one */
    height: 70vh;
    min-height: 0;
  }

  .chat {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }

  .review-layout > * {
    min-height: 0;
  }

  /* the chat stays the primary surface; the map gets the extra room only once it exists */
  .review-layout.with-html .chat {
    flex: 0 0 min(46%, 560px);
  }

  .chat-log {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 2px 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .review-empty {
    color: var(--text-faint);
    font-size: 13px;
    padding: 18px 2px;
    max-width: 46ch;
    line-height: 1.5;
  }

  .turn header {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-bottom: 4px;
  }

  .who {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
  }

  .when {
    font-size: 11px;
    color: var(--text-faint);
  }

  .turn.user .md {
    border-left: 2px solid var(--border-hover);
    padding-left: 10px;
    color: var(--text-dim);
  }

  .md {
    font-size: 13px;
    line-height: 1.55;
  }

  .md :global(pre) {
    overflow-x: auto;
    background: var(--surface);
    border-radius: 6px;
    padding: 8px 10px;
    font-family: var(--mono);
    font-size: 12px;
  }

  .md :global(code) {
    font-family: var(--mono);
    font-size: 12px;
  }

  .md :global(p) {
    margin: 0 0 8px;
  }

  .md :global(p:last-child) {
    margin-bottom: 0;
  }

  .thinking {
    font-size: 12px;
    color: var(--text-faint);
  }

  .send-error {
    font-size: 12px;
    color: var(--native-red);
    padding: 6px 2px;
  }

  .composer {
    border-top: 1px solid var(--border);
    padding-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .prompt-templates {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .template {
    font: inherit;
    font-size: 12px;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text-dim);
    cursor: pointer;
  }

  .template:hover:not(:disabled) {
    background: var(--surface-hover);
    color: var(--text);
  }

  .template:disabled {
    opacity: 0.5;
    cursor: default;
  }

  textarea {
    font: inherit;
    font-size: 13px;
    resize: vertical;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
  }

  textarea:focus {
    outline: none;
    border-color: var(--border-hover);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }

  .composer-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }

  .composer-hint {
    font-size: 11px;
    color: var(--text-faint);
  }

  .send {
    font: inherit;
    font-size: 12px;
    padding: 4px 12px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
  }

  .send:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .html-pane {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .html-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-raised);
    font-size: 12px;
  }

  .html-title {
    color: var(--text-dim);
    font-weight: 600;
  }

  .stale {
    color: var(--native-orange);
  }

  .html-open {
    margin-left: auto;
    color: var(--text-faint);
  }

  iframe {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 0;
    background: #0d0d0f;
  }

  @media (max-width: 900px) {
    .review-layout {
      flex-direction: column;
    }

    .review-layout.with-html .chat {
      flex: 1 1 auto;
    }

    .html-pane {
      min-height: 420px;
    }
  }
</style>
