import { DEFAULT_SENTRY_DSN } from "../shared/sentry.ts";

export interface InstallFailure {
  stage: string;
  status: number;
  platform: string;
  substep?: string;
  detail?: string;
}

export const MAX_INSTALL_FAILURE_DETAIL_BYTES = 4_096;

function redactInstallFailureDetail(detail: string, preserveEnd = false): string {
  let redacted = detail
    .replaceAll("\0", "")
    .replace(/(https?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1[redacted]@")
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+\b/g, "[redacted]")
    .replace(/\b(Bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/\b((?:[A-Za-z][A-Za-z0-9_-]*[_-])?)(token|auth[_-]?token|password|secret|authorization|api[_-]?key)(\s*[:=]\s*)([^\s]+)/gi, "$1$2$3[redacted]");
  const home = process.env.HOME;
  if (home && home !== "/") redacted = redacted.replaceAll(home, "<home>");
  redacted = redacted
    .replace(/\/(?:Users|home)\/[^/\s]+/g, "<home>")
    .replace(/\/root(?=\/|\s|$)/g, "<home>");
  const bytes = Buffer.from(redacted);
  if (bytes.length <= MAX_INSTALL_FAILURE_DETAIL_BYTES) return redacted;
  const retained = preserveEnd
    ? bytes.subarray(bytes.length - MAX_INSTALL_FAILURE_DETAIL_BYTES + 16).toString("utf8")
    : bytes.subarray(0, MAX_INSTALL_FAILURE_DETAIL_BYTES - 16).toString("utf8");
  return preserveEnd ? `[truncated]\n${retained}` : `${retained}\n[truncated]`;
}

function envelopeEndpoint(dsn: URL): URL {
  const path = dsn.pathname.split("/").filter(Boolean);
  const projectId = path.pop();
  if (!dsn.username || !projectId) throw new Error("invalid Sentry DSN");
  return new URL(`${path.length ? `/${path.join("/")}` : ""}/api/${projectId}/envelope/`, dsn.origin);
}

export async function reportInstallFailure(
  failure: InstallFailure,
  dsn = Bun.env.COCKPIT_SENTRY_DSN ?? DEFAULT_SENTRY_DSN,
): Promise<void> {
  if (dsn === "") return;
  try {
    const eventId = crypto.randomUUID().replaceAll("-", "");
    const sentAt = new Date().toISOString();
    const detail = failure.detail?.trim();
    const event = {
      event_id: eventId,
      timestamp: sentAt,
      level: "error",
      platform: "javascript",
      logger: "pr-cockpit.installer",
      message: `Installation failed during ${failure.stage} (exit ${failure.status})`,
      tags: {
        component: "installer",
        install_stage: failure.stage,
        install_status: String(failure.status),
        install_platform: failure.platform,
        ...(failure.substep ? { install_substep: failure.substep } : {}),
      },
      ...(detail ? { extra: { error_detail: redactInstallFailureDetail(detail) } } : {}),
    };
    const body = [
      JSON.stringify({ event_id: eventId, dsn, sent_at: sentAt }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
    await fetch(envelopeEndpoint(new URL(dsn)), {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body,
      signal: AbortSignal.timeout(2_000),
    });
  } catch {}
}

async function boundedFileTail(path: string): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const file = Bun.file(path);
    const end = file.size;
    const start = Math.max(0, end - MAX_INSTALL_FAILURE_DETAIL_BYTES * 2);
    let text = await file.slice(start, end).text();
    if (start > 0) {
      const firstLineEnd = text.indexOf("\n");
      if (firstLineEnd !== -1) text = text.slice(firstLineEnd + 1);
    }
    const selected: string[] = [];
    let selectedBytes = 0;
    for (const line of text.split("\n").reverse()) {
      const lineBytes = Buffer.byteLength(line) + 1;
      if (lineBytes > MAX_INSTALL_FAILURE_DETAIL_BYTES) {
        selected.push(redactInstallFailureDetail(line, true));
        break;
      }
      if (selectedBytes + lineBytes > MAX_INSTALL_FAILURE_DETAIL_BYTES) break;
      selected.push(line);
      selectedBytes += lineBytes;
    }
    return selected.reverse().join("\n");
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  const [stage = "unknown", status = "1", platform = process.platform, substep = "", detailFile = ""] = process.argv.slice(2);
  await reportInstallFailure({
    stage,
    status: Number(status) || 1,
    platform,
    ...(substep ? { substep } : {}),
    detail: await boundedFileTail(detailFile),
  });
}
