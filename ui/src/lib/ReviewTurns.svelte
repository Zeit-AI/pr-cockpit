<script>
  import { progressTurns, toolLabel, toolPrimaryArg } from "./agentTurns.js";

  // The Agents tab's turn-by-turn view, applied to the review agent's live event stream. Same shape
  // of data (server-side `turnsFromLines`), same reading: assistant text, then the tool calls under it.
  let { turns = [], expanded = false } = $props();

  let shown = $derived(progressTurns(turns));
  let openTurns = $state(new Set());

  function toggle(i) {
    const next = new Set(openTurns);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    openTurns = next;
  }

  // only the tail matters while it runs; the whole stream is there once you open it
  let visible = $derived(expanded ? shown : shown.slice(-4));
  let hiddenCount = $derived(shown.length - visible.length);
</script>

{#if shown.length > 0}
  <div class="turns">
    {#if hiddenCount > 0}<div class="turns-more mono">…{hiddenCount} earlier step{hiddenCount === 1 ? "" : "s"}</div>{/if}
    {#each visible as turn, i (i)}
      {#if turn.kind === "text"}
        <div class="turn turn-text mono">{turn.text}</div>
      {:else}
        {@const primary = toolPrimaryArg(turn.toolInput)}
        <div class="turn turn-tool mono">
          <button class="turn-toggle" onclick={() => toggle(i)}>
            <span class="turn-line">{toolLabel(turn, primary)}</span>
          </button>
          {#if openTurns.has(i) && primary}<pre class="turn-arg">{primary[1]}</pre>{/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .turns {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
  }

  .turns-more {
    font-size: 11px;
    color: var(--text-faint);
    padding-left: 2px;
  }

  .turn {
    font-size: 11.5px;
    line-height: 1.45;
    border-radius: 6px;
    padding: 5px 8px;
    background: var(--surface);
    color: var(--text-dim);
    min-width: 0;
  }

  .turn-text {
    color: var(--text);
    white-space: pre-wrap;
  }

  .turn-toggle {
    display: block;
    width: 100%;
    font: inherit;
    text-align: left;
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    cursor: pointer;
    min-width: 0;
  }

  .turn-line {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .turn-arg {
    margin: 6px 0 0;
    padding: 6px 8px;
    background: var(--panel);
    border-radius: 4px;
    font-size: 11px;
    max-height: 220px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
