/** Structured server-side logging for API rejections and failures. */

export type ApiLogContext = Record<string, unknown>;

function formatContext(ctx?: ApiLogContext): string {
  if (!ctx || Object.keys(ctx).length === 0) return "";
  try {
    return ` ${JSON.stringify(ctx)}`;
  } catch {
    return " [context unserializable]";
  }
}

/** Log a deliberate 4xx response (client error, rate limit, conflict, etc.). */
export function logApiReject(tag: string, error: string, ctx?: ApiLogContext): void {
  console.warn(`[${tag}] ${error}${formatContext(ctx)}`);
}

/** Log an unexpected server error (5xx, thrown exception). */
export function logApiError(tag: string, message: string, err?: unknown, ctx?: ApiLogContext): void {
  const suffix = formatContext(ctx);
  if (err !== undefined) {
    console.error(`[${tag}] ${message}${suffix}`, err);
  } else {
    console.error(`[${tag}] ${message}${suffix}`);
  }
}

/** Zod issue summary safe for logs (no raw user input). */
export function zodIssueSummary(issues: { path: PropertyKey[]; code: string }[]): ApiLogContext {
  return {
    issues: issues.map((i) => ({ path: i.path.join("."), code: i.code })),
  };
}
