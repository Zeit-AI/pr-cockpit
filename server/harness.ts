import { existsSync } from "node:fs";
import { getSetting } from "./db.ts";

// which headless coding CLI the agents drive; each emits a JSON event stream on stdout
export type Harness = "claude" | "omp" | "codex";

export function claudeBinPath(): string | null {
  return Bun.which("claude") ?? [`${process.env.HOME}/.local/bin/claude`, `${process.env.HOME}/.claude/local/claude`].find(existsSync) ?? null;
}

export function ompBinPath(): string | null {
  return Bun.which("omp") ?? [`${process.env.HOME}/.bun/bin/omp`, `${process.env.HOME}/.local/bin/omp`].find(existsSync) ?? null;
}

export function codexBinPath(): string | null {
  return Bun.which("codex") ?? [`${process.env.HOME}/.local/bin/codex`, `${process.env.HOME}/.bun/bin/codex`].find(existsSync) ?? null;
}

// preserve the existing default, but use Codex when it is the only installed harness
export function detectHarness(): Harness {
  if (ompBinPath()) return "omp";
  if (claudeBinPath()) return "claude";
  return codexBinPath() ? "codex" : "claude";
}

export function normalizeHarness(value: unknown): Harness {
  return value === "omp" || value === "codex" ? value : "claude";
}

export function agentHarness(): Harness {
  return normalizeHarness(getSetting("agent_harness"));
}

export function harnessBin(harness: Harness = agentHarness()): string {
  const found = harness === "omp" ? ompBinPath() : harness === "codex" ? codexBinPath() : claudeBinPath();
  if (!found) throw new Error(`${harness} binary not found - install it or switch the agent harness in Settings`);
  return found;
}

function ompModel(model: string): string {
  if (model === "opus") return "anthropic/claude-opus-5";
  if (model === "sonnet") return "anthropic/claude-sonnet-5";
  return model;
}

// Optional per-run extras. Only Claude understands all three; the omp and codex invocations already
// run with approvals bypassed, so they can read an added directory without being granted it.
export interface HarnessExtras {
  addDirs?: string[];
  // low | medium | high | xhigh | max, as the harness defines them
  effort?: string;
  appendSystemPrompt?: string;
}

// codex spells effort as a config value and has no notion of "xhigh"/"max"
function codexEffort(effort: string | undefined, model: string): string {
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  if (effort) return "high";
  return model.includes("sonnet") ? "medium" : "high";
}

export function harnessFlags(
  prompt: string,
  model: string,
  useContinue: boolean,
  harness: Harness,
  extras: HarnessExtras = {},
): string[] {
  if (harness === "codex") {
    const args = useContinue ? ["exec", "resume", "--last"] : ["exec"];
    args.push(
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      `model_reasoning_effort="${codexEffort(extras.effort, model)}"`,
      // codex has no system-prompt flag, so the agent's standing instructions ride with the message
      extras.appendSystemPrompt ? `${extras.appendSystemPrompt}\n\n${prompt}` : prompt,
    );
    return args;
  }
  if (harness === "omp") {
    const args = ["--print", "--mode", "json", "--model", ompModel(model), "--auto-approve", "--no-title"];
    if (useContinue) args.push("--continue");
    // omp has no system-prompt flag either
    args.push(extras.appendSystemPrompt ? `${extras.appendSystemPrompt}\n\n${prompt}` : prompt);
    return args;
  }
  const args = ["-p", prompt, "--model", model, "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"];
  for (const dir of extras.addDirs ?? []) args.push("--add-dir", dir);
  if (extras.effort) args.push("--effort", extras.effort);
  // appended, not replaced: the harness's own tool instructions still apply
  if (extras.appendSystemPrompt) args.push("--append-system-prompt", extras.appendSystemPrompt);
  if (useContinue) args.push("--continue");
  return args;
}

export function harnessArgs(
  prompt: string,
  model: string,
  useContinue = false,
  harness: Harness = agentHarness(),
  extras: HarnessExtras = {},
): string[] {
  return [harnessBin(harness), ...harnessFlags(prompt, model, useContinue, harness, extras)];
}
