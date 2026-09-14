import { db, getCachedPrDetail, getFileContents, getPr, listPrs, saveFileContents } from "./db.ts";
import { fetchMirror, fileFromMirror, materializePrWorktree } from "./mirror.ts";

// Offline reading. Expanding a diff already prefers local sources, so the failures people actually
// hit are cold-cache ones: the blob was never warmed, and the first request for it is the one made on
// a train. Two answers here - warm every changed file the moment a PR is opened, and let a repo be
// pinned so its mirror, worktree and blobs are guaranteed present and exempt from pruning.
db.exec(`
CREATE TABLE IF NOT EXISTS offline_pins (
  repo TEXT PRIMARY KEY,
  pinned_at TEXT NOT NULL
);
`);

export function pinRepo(repo: string): void {
  db.query("INSERT OR REPLACE INTO offline_pins (repo, pinned_at) VALUES (?, ?)").run(repo, new Date().toISOString());
}

export function unpinRepo(repo: string): void {
  db.query("DELETE FROM offline_pins WHERE repo = ?").run(repo);
}

export function isRepoPinned(repo: string): boolean {
  return db.query("SELECT 1 FROM offline_pins WHERE repo = ?").get(repo) !== null;
}

export function pinnedRepos(): string[] {
  return (db.query("SELECT repo FROM offline_pins ORDER BY repo").all() as Array<{ repo: string }>).map((row) => row.repo);
}

// The changed files of a PR, from whichever cached detail we have. Never fetched: warming is a
// best-effort background errand and must not itself become a network dependency.
function changedFiles(repo: string, number: number): { headSha: string; paths: string[] } | null {
  const detailJson = getPr(repo, number)?.detail_json ?? getCachedPrDetail(repo, number)?.detail_json;
  if (!detailJson) return null;
  const detail = JSON.parse(detailJson) as {
    headRefOid?: string;
    files?: { nodes?: Array<{ path?: string }> };
  };
  const headSha = getPr(repo, number)?.head_sha ?? getCachedPrDetail(repo, number)?.head_sha ?? detail.headRefOid;
  if (!headSha) return null;
  const paths = (detail.files?.nodes ?? []).map((node) => node.path).filter((path): path is string => typeof path === "string");
  return { headSha, paths };
}

export interface WarmResult {
  warmed: number;
  alreadyCached: number;
  unavailable: number;
}

// Reads blobs out of the mirror into the SQLite cache. Mirror-only on purpose: warming must not spend
// GitHub quota on files nobody has asked to see, and a repo with no mirror yet has nothing to warm.
export async function warmPrFiles(repo: string, number: number): Promise<WarmResult> {
  const result: WarmResult = { warmed: 0, alreadyCached: 0, unavailable: 0 };
  const changed = changedFiles(repo, number);
  if (!changed) return result;
  for (const path of changed.paths) {
    if (getFileContents(changed.headSha, path) !== null) {
      result.alreadyCached += 1;
      continue;
    }
    try {
      const file = await fileFromMirror(repo, changed.headSha, path);
      if (file.status === "ok") {
        saveFileContents(changed.headSha, path, file.content);
        result.warmed += 1;
      } else {
        result.unavailable += 1;
      }
    } catch {
      result.unavailable += 1;
    }
  }
  return result;
}

// Fire-and-forget warming for a PR that was just opened. Deduplicated because the detail view issues
// several requests per open and every one of them would otherwise start its own pass over the blobs.
const warming = new Set<string>();

export function warmPrFilesInBackground(repo: string, number: number): void {
  const key = `${repo}#${number}`;
  if (warming.has(key)) return;
  warming.add(key);
  warmPrFiles(repo, number)
    .catch((err) => console.error(`offline warm failed for ${key}:`, err))
    .finally(() => warming.delete(key));
}

export interface PinResult {
  repo: string;
  mirror: "ready" | "failed";
  worktrees: number;
  files: WarmResult;
  error?: string;
}

// Pinning is the explicit "I am about to lose the network" action: it pays the whole cost up front -
// mirror, one worktree per open PR, every changed blob - and marks the repo so pruneMirrors leaves it
// alone. Unpinning does not delete anything; the next prune sweep reclaims it on its own schedule.
export async function pinRepoForOffline(repo: string, numbers: number[]): Promise<PinResult> {
  pinRepo(repo);
  const result: PinResult = { repo, mirror: "ready", worktrees: 0, files: { warmed: 0, alreadyCached: 0, unavailable: 0 } };
  try {
    await fetchMirror(repo);
  } catch (err) {
    result.mirror = "failed";
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
  for (const number of numbers) {
    const headSha = getPr(repo, number)?.head_sha ?? getCachedPrDetail(repo, number)?.head_sha;
    if (!headSha) continue;
    try {
      // a dirty worktree makes this throw; that PR simply stays unmaterialized rather than failing the pin
      await materializePrWorktree(repo, number, headSha);
      result.worktrees += 1;
    } catch (err) {
      console.error(`offline pin could not materialize ${repo}#${number}:`, err);
    }
    const warmed = await warmPrFiles(repo, number);
    result.files.warmed += warmed.warmed;
    result.files.alreadyCached += warmed.alreadyCached;
    result.files.unavailable += warmed.unavailable;
  }
  return result;
}

// Last resort for a file the network cannot supply: the same path at whatever commit we last saw it.
// A diff expansion showing slightly old content, labelled as such, beats an error where the code
// should be - the reader is trying to understand a function, not audit a byte range.
export function staleFileContents(path: string, notSha: string): { content: string; sha: string } | null {
  const row = db.query(
    "SELECT sha, content FROM file_contents WHERE path = ? AND sha != ? ORDER BY rowid DESC LIMIT 1",
  ).get(path, notSha) as { sha: string; content: string } | null;
  return row ? { content: row.content, sha: row.sha } : null;
}

// "/offline/pin" and its "/api"-prefixed twin. Routing lives here rather than inline in http.ts so the
// whole feature - storage, warming, and the endpoint - is one file to read and one file to revert.
export async function handleOfflineRoute(parts: string[], req: Request, url: URL): Promise<Response | null> {
  const isPin =
    (parts.length === 2 && parts[0] === "offline" && parts[1] === "pin") ||
    (parts.length === 3 && parts[0] === "api" && parts[1] === "offline" && parts[2] === "pin");
  if (!isPin) return null;

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

  if (req.method === "GET") return json({ repos: pinnedRepos() });
  const repo = url.searchParams.get("repo") ?? "";
  if (!/^[^/]+\/[^/]+$/.test(repo)) return json({ error: "repo must be owner/name" }, 400);
  if (req.method === "DELETE") {
    unpinRepo(repo);
    return json({ pinned: false, repo });
  }
  if (req.method !== "POST") return null;
  const numbers = listPrs().filter((pr) => pr.repo === repo && pr.state === "OPEN").map((pr) => pr.number);
  return json({ pinned: true, ...(await pinRepoForOffline(repo, numbers)) });
}
