/** Public site URL from NEXT_PUBLIC_BASE_URL. */
export function siteBaseUrl(fallback = ""): string {
  return process.env.NEXT_PUBLIC_BASE_URL || fallback;
}

/** Hostname (with port in dev) for display, derived from the site URL. */
export function siteHost(fallback = ""): string {
  const base = siteBaseUrl(fallback);
  if (!base) return "";
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  }
}
