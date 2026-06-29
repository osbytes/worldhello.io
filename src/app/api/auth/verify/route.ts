import { NextRequest, NextResponse } from "next/server";
import { verifyNonce } from "@/lib/token";
import { executeMagicVerify, magicTokenStatus } from "@/lib/magic-verify";
import type { VerifyFailureReason } from "@/lib/verify-feedback";

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
  if (!nonce) return failRedirect(req, "invalid");
  const status = await magicTokenStatus(nonce);
  if (status !== "valid") {
    return failRedirect(req, status === "expired" ? "expired" : "used");
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
  <h1>Verify your account</h1>
  <p>Confirm on <strong>the same device</strong> that requested this email. This verifies your account — it does not link other devices.</p>
  <form method="POST" action="/api/auth/verify">
    <input type="hidden" name="token" value="${safeToken}" />
    <button type="submit">Verify my account</button>
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
  if (!nonce) return failRedirect(req, "invalid");
  if (!deviceLocalId) return failRedirect(req, "no_session");

  try {
    const result = await executeMagicVerify(nonce, deviceLocalId);
    if (result === "ok") {
      return NextResponse.redirect(new URL("/?verified=1", req.nextUrl.origin));
    }
    if (result === "device_mismatch") {
      return failRedirect(req, "wrong_device");
    }
    if (result === "token_invalid") {
      return failRedirectForToken(req, nonce);
    }
  } catch (err) {
    console.error("[auth/verify] magic verify failed:", err);
    return failRedirect(req, "error");
  }

  return failRedirect(req, "error");
}

function failRedirect(req: NextRequest, reason: VerifyFailureReason) {
  return NextResponse.redirect(new URL(`/?verify=${reason}`, req.nextUrl.origin));
}

async function failRedirectForToken(req: NextRequest, nonce: string) {
  const status = await magicTokenStatus(nonce);
  if (status === "expired") return failRedirect(req, "expired");
  return failRedirect(req, "used");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
