// Shared reading of the harness event turns that `turnsFromLines` produces server-side. PrDetail.svelte
// keeps its own copy of these helpers for the Agents tab: that file is held to a three-line diff against
// upstream so every pull keeps merging, which is worth more than de-duplicating two small functions.
const TOOL_PRIMARY_KEYS = ["command", "file_path", "content", "pattern", "query", "url", "prompt"];

export function toolPrimaryArg(input) {
  if (!input || typeof input !== "object") return null;
  for (const key of TOOL_PRIMARY_KEYS) {
    if (typeof input[key] === "string" && input[key]) return [key, input[key]];
  }
  return Object.entries(input).find(([, v]) => typeof v === "string" && v) ?? null;
}

export function toolLabel(turn, primary) {
  let summary = "";
  if (typeof turn.toolInput?.description === "string" && turn.toolInput.description) {
    summary = turn.toolInput.description;
  } else if (primary) {
    const flat = primary[1].replace(/\s+/g, " ").trim();
    summary = flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
  }
  return summary ? `→ ${turn.toolName} — ${summary}` : `→ ${turn.toolName}`;
}

// the trailing "result" turn is the answer itself, which the transcript already shows
export function progressTurns(turns) {
  return turns.filter((turn) => turn.kind !== "result");
}

export function elapsedText(startedAt, nowMs) {
  const startMs = Date.parse(startedAt ?? "");
  if (Number.isNaN(startMs)) return "";
  const seconds = Math.max(0, Math.round((nowMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}
