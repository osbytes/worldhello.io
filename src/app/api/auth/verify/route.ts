import { NextRequest, NextResponse } from "next/server";
import { verifyNonce } from "@/lib/token";
import { peekMagicToken, executeMagicVerify } from "@/lib/magic-verify";

export const runtime = "nodejs";

const COOKIE = "wh_lid";

/**
 * Magic-link verify → email account link (DESIGN §5.5).
 *  - GET: confirmation page (token not consumed — safe from email prefetch)
 *  - POST: consume token + link ONLY when the requesting device's cookie matches
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const nonce = token ? verifyNonce(token) : null;
  if (!nonce || !(await peekMagicToken(nonce))) {
    return failRedirect(req);
  }

  const safeToken = escapeHtml(token!);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Verify email — worldhello.io</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; color: #e8e8e8; background: #0a0a0f; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #a0a0b0; line-height: 1.5; }
    button { margin-top: 1rem; padding: 0.75rem 1.25rem; font-size: 1rem; font-weight: 600; color: #0a0a0f; background: #7dd3fc; border: none; border-radius: 0.5rem; cursor: pointer; }
    button:hover { background: #bae6fd; }
  </style>
</head>
<body>
  <h1>Link your network</h1>
  <p>Confirm on <strong>the same device</strong> that requested this email. Verification keeps your referral stats if you switch browsers or devices later.</p>
  <form method="POST" action="/api/auth/verify">
    <input type="hidden" name="token" value="${safeToken}" />
    <button type="submit">Verify &amp; link email</button>
  </form>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  let token: string | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    token = body?.token ?? null;
  } else {
    const form = await req.formData().catch(() => null);
    token = form?.get("token")?.toString() ?? null;
  }

  const nonce = token ? verifyNonce(token) : null;
  const deviceLocalId = req.cookies.get(COOKIE)?.value;
  if (!nonce || !deviceLocalId) return failRedirect(req);

  try {
    const result = await executeMagicVerify(nonce, deviceLocalId);
    if (result === "ok") {
      return NextResponse.redirect(new URL("/?verified=1", req.nextUrl.origin));
    }
    if (result === "device_mismatch") {
      return mismatchPage(req);
    }
  } catch (err) {
    console.error("[auth/verify] magic verify failed:", err);
  }

  return failRedirect(req);
}

function failRedirect(req: NextRequest) {
  return NextResponse.redirect(new URL("/?verify=failed", req.nextUrl.origin));
}

function mismatchPage(req: NextRequest) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Verification failed — worldhello.io</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; color: #e8e8e8; background: #0a0a0f; }
    h1 { font-size: 1.25rem; }
    p { color: #a0a0b0; line-height: 1.5; }
    a { color: #7dd3fc; }
  </style>
</head>
<body>
  <h1>Wrong device</h1>
  <p>Open this link on the <strong>same browser</strong> where you requested the verification email, then try again.</p>
  <p><a href="/">Return to worldhello.io</a></p>
</body>
</html>`;
  return new NextResponse(html, {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
