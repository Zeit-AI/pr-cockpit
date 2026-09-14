<script>
  // Pin a repository for offline reading. Everything Cockpit needs to serve a PR without a network -
  // the mirror, a worktree per open PR, and every changed file's blob in the cache - is fetched when
  // you pin, and the mirror is then exempt from the sweep that reclaims idle ones. Unpinning deletes
  // nothing; it just lets the ordinary prune schedule have the repo back.
  let { repos = [] } = $props();

  let pinned = $state([]);
  let busy = $state(null);
  let result = $state(null);
  let error = $state(null);

  async function load() {
    try {
      const res = await fetch("/api/offline/pin");
      if (!res.ok) throw new Error(`offline pins ${res.status}`);
      pinned = (await res.json()).repos ?? [];
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  $effect(() => {
    load();
  });

  async function toggle(repo) {
    if (busy) return;
    busy = repo;
    error = null;
    result = null;
    try {
      const method = pinned.includes(repo) ? "DELETE" : "POST";
      const res = await fetch(`/api/offline/pin?repo=${encodeURIComponent(repo)}`, { method });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `offline pin ${res.status}`);
      if (method === "POST") {
        result = body.mirror === "failed"
          ? `Could not fetch ${repo}: ${body.error ?? "mirror fetch failed"}`
          : `${repo} ready offline — ${body.worktrees} worktree${body.worktrees === 1 ? "" : "s"}, ${body.files.warmed + body.files.alreadyCached} files cached`;
      }
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }
</script>

<div class="field field-wide">
  <span class="label">Offline</span>
  <span class="hint">Keep a repository readable with no network: mirror, worktrees, and every changed file cached up front.</span>
  {#if repos.length === 0}
    <span class="hint">Add a repository above first.</span>
  {:else}
    <div class="pins">
      {#each repos as repo (repo)}
        <button class="pin" class:on={pinned.includes(repo)} disabled={busy === repo} onclick={() => toggle(repo)}>
          <span class="mono">{repo}</span>
          <span class="verb">{busy === repo ? "fetching…" : pinned.includes(repo) ? "pinned" : "pin"}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if result}<span class="hint">{result}</span>{/if}
  {#if error}<span class="hint bad">{error}</span>{/if}
</div>

<style>
  .pins { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .pin {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 4px 8px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .pin:hover:not(:disabled) { border-color: var(--border-hover); background: var(--surface-hover); }
  .pin:disabled { opacity: 0.6; cursor: default; }
  .pin.on { border-color: var(--ready); }
  .verb { color: var(--text-faint); font-size: 11px; }
  .pin.on .verb { color: var(--ready); }
  .bad { color: var(--native-red); }
</style>
