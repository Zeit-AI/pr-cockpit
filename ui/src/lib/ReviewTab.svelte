<script>
  import Kbd from "./Kbd.svelte";
  import ReviewTurns from "./ReviewTurns.svelte";
  import { askReview, fetchReviewConfig, fetchReviewState, saveReviewConfig } from "./api.js";
  import { renderMarkdown } from "./markdown.js";
  import { relativeTime } from "./time.js";
  import { elapsedText } from "./agentTurns.js";
  import { REVIEW_PROMPTS } from "./reviewPrompts.js";
  import { theme } from "./theme.svelte.js";

  let { repo, number } = $props();

  // the PR view's fixed key bar overlaps the very bottom of the page
  const BOTTOM_GUTTER = 34;

  let state = $state(null);
  let config = $state(null);
  let loadError = $state(null);
  let draft = $state("");
  let sendError = $state(null);
  let input = $state(null);
  let log = $state(null);
  let root = $state(null);
  let available = $state(null);
  let frame = $state(null);
  let showProgress = $state(false);
  let configOpen = $state(false);
  let now = $state(Date.now());

  let turns = $derived(state?.turns ?? []);
  let queued = $derived(state?.queued ?? []);
  let running = $derived(state?.running === true);
  let busy = $derived(running || queued.length > 0);
  // cache-busted so a rewritten page is actually re-fetched, and themed so it follows cockpit
  let htmlSrc = $derived(
    state?.htmlExists
      ? `/review/${repo}/${number}/index.html?theme=${theme.name}&v=${encodeURIComponent(state.htmlUpdatedAt ?? "")}`
      : null,
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
    fetchReviewConfig(repo).then((next) => (config = next), () => {});
  });

  // the answer lands in the transcript server-side, so polling is what shows it - including when this
  // tab was closed, or the window reopened, part-way through a long answer
  $effect(() => {
    const timer = setInterval(load, busy ? 2000 : 15000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  // Available height, measured rather than hard-coded: the header and tab bar above vary with the PR,
  // and PrDetail.svelte is not ours to restructure. Re-measures until it converges, because sizing
  // this tab is itself what removes the page scroll that shifted the measurement.
  $effect(() => {
    if (!root) return;
    const fit = () => {
      const top = root.getBoundingClientRect().top + window.scrollY;
      const next = Math.max(320, document.documentElement.clientHeight - top - BOTTOM_GUTTER);
      if (available === null || Math.abs(next - available) > 1) available = next;
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
    queued.length;
    running;
    if (log) log.scrollTop = log.scrollHeight;
  });

  // the iframe is sandboxed without same-origin, so the theme travels as a message, not a DOM write
  $effect(() => {
    const next = theme.name;
    frame?.contentWindow?.postMessage({ type: "cockpit-theme", theme: next }, "*");
  });

  async function send(message) {
    const text = message.trim();
    if (!text) return;
    sendError = null;
    draft = "";
    try {
      await askReview(repo, number, text);
    } catch (err) {
      sendError = err.message;
    }
    await load();
  }

  function onKey(event) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send(draft);
    }
  }

  async function setConfig(patch) {
    try {
      config = await saveReviewConfig(repo, patch);
      await load();
    } catch (err) {
      sendError = err.message;
    }
  }

  let notesDraft = $state(null);
  let notesSaved = $state(false);

  async function saveNotes() {
    await setConfig({ notes: notesDraft ?? "" });
    notesSaved = true;
    setTimeout(() => (notesSaved = false), 1500);
  }

  let modelLabel = $derived(
    config?.models?.find((m) => m.id === config.model)?.label ?? config?.model ?? "",
  );
</script>

<div
  class="review-layout"
  class:with-html={!!htmlSrc}
  bind:this={root}
  style:--available={available === null ? null : `${available}px`}
>
  <section class="chat">
    <div class="chat-log" bind:this={log}>
      {#if loadError}
        <div class="review-empty">Couldn’t load this review: {loadError}</div>
      {:else if turns.length === 0 && !busy}
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

      {#if running}
        <div class="progress">
          <header>
            <span class="who">Review agent</span>
            <span class="when">working · {elapsedText(state.startedAt, now)}</span>
            <button class="link" onclick={() => (showProgress = !showProgress)}>
              {showProgress ? "collapse" : "all steps"}
            </button>
          </header>
          {#if (state.agentTurns ?? []).length === 0}
            <div class="thinking">Starting up…</div>
          {/if}
          <ReviewTurns turns={state.agentTurns ?? []} expanded={showProgress} />
        </div>
      {/if}

      {#each queued as message, i (i)}
        <article class="turn user queued">
          <header>
            <span class="who">You</span>
            <span class="when">queued</span>
          </header>
          <div class="md"><p>{message}</p></div>
        </article>
      {/each}
    </div>

    {#if sendError}<div class="send-error">{sendError}</div>{/if}

    <div class="composer">
      <div class="prompt-templates">
        {#each REVIEW_PROMPTS as prompt (prompt.label)}
          <button class="template" onclick={() => send(prompt.message)}>{prompt.label}</button>
        {/each}
      </div>
      <textarea bind:this={input} bind:value={draft} onkeydown={onKey} rows="3" placeholder="Ask about this PR…"></textarea>
      <div class="composer-actions">
        {#if config}
          <div class="config">
            <button class="link config-toggle" onclick={() => (configOpen = !configOpen)}>
              {modelLabel} · {config.effort}
            </button>
            {#if configOpen}
              <div class="config-menu">
                <label>
                  Model
                  <select value={config.model} onchange={(e) => setConfig({ model: e.currentTarget.value })}>
                    {#each config.models ?? [] as choice (choice.id)}
                      <option value={choice.id}>{choice.label}</option>
                    {/each}
                  </select>
                </label>
                <label>
                  Thinking
                  <select value={config.effort} onchange={(e) => setConfig({ effort: e.currentTarget.value })}>
                    {#each config.efforts ?? [] as level (level)}
                      <option value={level}>{level}</option>
                    {/each}
                  </select>
                </label>
                <label>
                  Notes for {repo}
                  <textarea
                    class="notes"
                    rows="6"
                    placeholder="Standing context for this repository — subsystem names, where the seams are, what a reviewer here always has to check."
                    value={notesDraft ?? config.notes ?? ""}
                    oninput={(e) => (notesDraft = e.currentTarget.value)}
                  ></textarea>
                </label>
                <div class="config-row">
                  <p class="config-note">Model and effort are shared; notes belong to this repository. Applied to the next message.</p>
                  <button class="link" onclick={saveNotes}>{notesSaved ? "saved" : "save"}</button>
                </div>
              </div>
            {/if}
          </div>
        {/if}
        {#if queued.length > 0}<span class="composer-hint">{queued.length} queued</span>{/if}
        <button class="send" disabled={!draft.trim()} onclick={() => send(draft)}>
          Send {#if draft.trim()}<Kbd keys={["cmd", "enter"]} />{/if}
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
      <iframe bind:this={frame} src={htmlSrc} sandbox="allow-scripts" title="Review overview for {repo}#{number}"></iframe>
    </section>
  {/if}
</div>

<style>
  /* Two modes. With a map, both panes fill the viewport and each scrolls on its own. Without one,
     the chat sizes to its content so the composer sits directly under the last message instead of
     being pushed to the bottom of an empty column. */
  .review-layout {
    display: flex;
    gap: 12px;
    align-items: stretch;
    max-height: var(--available, 70vh);
    min-height: 0;
  }

  .review-layout.with-html {
    height: var(--available, 70vh);
  }

  .review-layout > :global(*) {
    min-height: 0;
  }

  .chat {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }

  .review-layout.with-html .chat {
    flex: 0 0 min(46%, 560px);
  }

  .chat-log {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 2px 2px 10px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .review-empty {
    color: var(--text-faint);
    font-size: 13px;
    padding: 2px 2px 6px;
    max-width: 52ch;
    line-height: 1.5;
  }

  .turn header,
  .progress header {
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

  .turn.queued {
    opacity: 0.6;
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

  .thinking,
  .send-error {
    font-size: 12px;
    color: var(--text-faint);
  }

  .send-error {
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

  .template:hover {
    background: var(--surface-hover);
    color: var(--text);
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

  .config {
    position: relative;
    margin-right: auto;
  }

  .config-toggle {
    font-size: 11px;
    color: var(--text-faint);
  }

  .config-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    width: 340px;
    max-width: calc(100vw - 32px);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow-surface);
  }

  .config-menu label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--text-dim);
  }

  .config-menu select {
    font: inherit;
    font-size: 12px;
    padding: 4px 6px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
  }

  .config-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .notes {
    font-size: 12px;
    line-height: 1.45;
  }

  .config-note {
    margin: 0;
    flex: 1;
    font-size: 11px;
    color: var(--text-faint);
    line-height: 1.4;
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
    background: var(--panel);
  }

  @media (max-width: 900px) {
    .review-layout,
    .review-layout.with-html {
      flex-direction: column;
      height: auto;
      max-height: none;
    }

    .review-layout.with-html .chat {
      flex: 1 1 auto;
    }

    .html-pane {
      min-height: 420px;
    }
  }
</style>
