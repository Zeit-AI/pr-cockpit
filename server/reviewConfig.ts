import { getSetting, setSetting } from "./db.ts";

// The review companion carries its own model and effort rather than an entry in AGENT_DEFAULTS: those
// are constrained to "opus" | "sonnet" aliases, and reviewing wants an explicit model id so the
// large-context variant can be pinned. Kept out of the main Settings object so the review tab owns
// its own control instead of threading two keys through five type declarations.
export const REVIEW_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReviewEffort = (typeof REVIEW_EFFORTS)[number];

// what the tab offers; any harness-valid id still round-trips through the API
export const REVIEW_MODEL_CHOICES = [
  { id: "claude-opus-5[1m]", label: "Opus 5 · 1M context" },
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5[1m]", label: "Sonnet 5 · 1M context" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export const DEFAULT_REVIEW_MODEL = "claude-opus-5[1m]";
export const DEFAULT_REVIEW_EFFORT: ReviewEffort = "medium";

// an alias ("opus"), a full id ("claude-opus-5"), or an id with a context-window suffix
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(\[[0-9]+[km]\])?$/;

export function normalizeReviewModel(value: unknown): string {
  return typeof value === "string" && MODEL_RE.test(value.trim()) ? value.trim() : DEFAULT_REVIEW_MODEL;
}

export function normalizeReviewEffort(value: unknown): ReviewEffort {
  return REVIEW_EFFORTS.includes(value as ReviewEffort) ? (value as ReviewEffort) : DEFAULT_REVIEW_EFFORT;
}

export interface ReviewConfig {
  model: string;
  effort: ReviewEffort;
}

export function reviewConfig(): ReviewConfig {
  return {
    model: normalizeReviewModel(getSetting("review_model")),
    effort: normalizeReviewEffort(getSetting("review_effort")),
  };
}

export function writeReviewConfig(patch: { model?: unknown; effort?: unknown }): ReviewConfig {
  if (patch.model !== undefined) setSetting("review_model", normalizeReviewModel(patch.model));
  if (patch.effort !== undefined) setSetting("review_effort", normalizeReviewEffort(patch.effort));
  return reviewConfig();
}
