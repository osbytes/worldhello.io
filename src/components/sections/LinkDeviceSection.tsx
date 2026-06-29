"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAfterLinkChange } from "@/lib/queries";
import QRCode from "qrcode";

type LinkSession = { code: string; url: string; expiresIn: number };

type AccountStatus = {
  emailVerified: boolean;
  devicesLinked: boolean;
  siblingCount: number;
};

function useAccountStatus() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/account");
      if (r.ok) setStatus((await r.json()) as AccountStatus);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { status, refresh };
}

/** Email magic-link verification — proves identity, separate from device linking. */
export function VerifyEmailPanel() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { status } = useAccountStatus();

  const sendMagic = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch("/api/auth/magic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (r.ok) setSent(true);
  };

  return (
    <div id="verify" className="card mt-5 p-6">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-purple/40 text-purple">
          ✉
        </span>
        <h3 className="text-lg font-semibold">Verify with email</h3>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        Prove this network belongs to you. We&apos;ll send a one-time link — click it to verify this
        device. Your email is never shown publicly. This does <span className="text-fg">not</span>{" "}
        share your referral link with anyone.
      </p>

      {status?.emailVerified ? (
        <p className="mt-4 text-sm text-purple">Email verified on this device.</p>
      ) : sent ? (
        <p className="mt-4 text-sm text-purple">Check your inbox — click the link to verify.</p>
      ) : (
        <form onSubmit={sendMagic} className="mt-5 flex max-w-md flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-muted/50 focus:border-purple/50"
            />
            <button className="btn-ghost shrink-0 whitespace-nowrap border-purple/40 px-4 py-3 text-sm text-purple">
              Send link
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Sync stats and globe across devices you own — reversible via unlink. */
export function LinkDevicesPanel({ nodeCode }: { nodeCode: string }) {
  const queryClient = useQueryClient();
  const { status, refresh } = useAccountStatus();
  const [session, setSession] = useState<LinkSession | null>(null);
  const [linkQr, setLinkQr] = useState("");
  const [loading, setLoading] = useState(false);
  const [enterCode, setEnterCode] = useState("");
  const [linkMsg, setLinkMsg] = useState<"idle" | "linked" | "unlinked" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const refreshAll = useCallback(() => {
    invalidateAfterLinkChange(queryClient, nodeCode);
    void refresh();
  }, [queryClient, nodeCode, refresh]);

  const createCode = async () => {
    setLoading(true);
    setLinkMsg("idle");
    setErrorMsg("");
    try {
      const r = await fetch("/api/auth/link", { method: "POST" });
      if (!r.ok) {
        setErrorMsg(r.status === 429 ? "Too many codes — try again later." : "Could not create code.");
        return;
      }
      setSession((await r.json()) as LinkSession);
    } catch {
      setErrorMsg("Could not create code.");
    } finally {
      setLoading(false);
    }
  };

  const acceptCode = async (raw: string) => {
    const code = raw.trim().toLowerCase();
    if (code.length !== 6) return false;

    setLoading(true);
    setLinkMsg("idle");
    setErrorMsg("");
    try {
      const r = await fetch("/api/auth/link/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === "same_device") {
          setErrorMsg("Same device — open this on your other phone or laptop.");
        } else if (body?.error === "invalid_code") {
          setErrorMsg("Invalid or expired code.");
        } else if (r.status === 429) {
          setErrorMsg("Too many attempts — wait a minute.");
        } else {
          setErrorMsg("Could not link devices.");
        }
        setLinkMsg("error");
        return false;
      }
      setLinkMsg("linked");
      setEnterCode("");
      refreshAll();
      return true;
    } catch {
      setErrorMsg("Could not link devices.");
      setLinkMsg("error");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const unlink = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const r = await fetch("/api/auth/unlink", { method: "POST" });
      if (!r.ok) {
        setErrorMsg("Could not unlink this device.");
        return;
      }
      setConfirmUnlink(false);
      setLinkMsg("unlinked");
      refreshAll();
    } catch {
      setErrorMsg("Could not unlink this device.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!session?.url) {
      setLinkQr("");
      return;
    }
    QRCode.toDataURL(session.url, {
      margin: 1,
      width: 180,
      color: { dark: "#5b9dff", light: "#0a0a0f" },
    })
      .then(setLinkQr)
      .catch(() => setLinkQr(""));
  }, [session?.url]);

  return (
    <div id="devices" className="card mt-5 p-6">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-blue/40 text-blue">
          ⇄
        </span>
        <h3 className="text-lg font-semibold">Link your devices</h3>
      </div>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        Merge this device with your phone, laptop, or tablet. Stats and globe arcs combine across
        linked devices. Unlinking restores this device&apos;s own view — nothing is deleted.
      </p>

      {linkMsg === "linked" && (
        <p className="mt-4 text-sm text-blue">Devices linked — shared stats and map view active.</p>
      )}
      {linkMsg === "unlinked" && (
        <p className="mt-4 text-sm text-muted">
          Device unlinked — showing this device&apos;s own stats and map again.
        </p>
      )}
      {status?.devicesLinked && (
        <p className="mt-4 text-sm text-blue">
          Linked with {status.siblingCount} other device{status.siblingCount === 1 ? "" : "s"}.
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-black/20 p-5">
          <div className="label text-blue">On this device</div>
          <p className="mt-2 text-sm text-muted">Generate a code for your other device to enter.</p>
          {session ? (
            <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              {linkQr && (
                <img src={linkQr} alt="Device sync QR" className="h-32 w-32 shrink-0 rounded-xl" />
              )}
              <div className="text-center sm:text-left">
                <p className="font-mono text-2xl font-semibold tracking-[0.2em] text-blue">{session.code}</p>
                <p className="mt-2 text-xs text-muted">
                  Expires in {Math.floor(session.expiresIn / 60)} min
                </p>
                <button
                  type="button"
                  onClick={createCode}
                  disabled={loading}
                  className="btn-ghost mt-3 px-3 py-1.5 text-xs"
                >
                  New code
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={createCode}
              disabled={loading}
              className="btn-ghost mt-4 border-blue/40 px-5 py-2.5 text-sm text-blue"
            >
              {loading ? "Creating…" : "Generate device code"}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-dashed border-white/10 bg-black/10 p-5">
          <div className="label">On your other device</div>
          <p className="mt-2 text-sm text-muted">Enter the code from your desktop or scan its QR.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void acceptCode(enterCode);
            }}
            className="mt-3 flex gap-2"
          >
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              value={enterCode}
              onChange={(e) =>
                setEnterCode(
                  e.target.value.toLowerCase().replace(/[^23456789abcdefghjkmnpqrstuvwxyz]/g, ""),
                )
              }
              placeholder="6-char code"
              className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm tracking-widest outline-none placeholder:text-muted/50 focus:border-blue/50"
            />
            <button
              type="submit"
              disabled={loading || enterCode.length !== 6}
              className="btn-ghost shrink-0 border-blue/40 px-4 py-3 text-sm text-blue"
            >
              Link
            </button>
          </form>
        </div>
      </div>

      {errorMsg && <p className="mt-4 text-sm text-red-400">{errorMsg}</p>}

      {status?.devicesLinked && (
        <div className="mt-6 border-t border-white/10 pt-6">
          {!confirmUnlink ? (
            <button
              type="button"
              onClick={() => setConfirmUnlink(true)}
              className="text-sm text-muted underline decoration-white/20 underline-offset-4 hover:text-fg"
            >
              Unlink this device
            </button>
          ) : (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
              <h4 className="text-sm font-semibold text-amber-200">Unlink this device?</h4>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
                <li>
                  This device stops sharing stats and map arcs with your other linked devices.
                </li>
                <li>
                  Your referral chain, share link, and per-device node are unchanged — only the
                  merged view is removed on <span className="text-fg">this device</span>.
                </li>
                <li>Other linked devices keep their connection. You can link again anytime.</li>
              </ul>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={unlink}
                  disabled={loading}
                  className="rounded-full border border-amber-500/50 bg-amber-500/15 px-5 py-2.5 text-sm font-medium text-amber-100 hover:bg-amber-500/25"
                >
                  {loading ? "Unlinking…" : "Yes, unlink this device"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmUnlink(false)}
                  disabled={loading}
                  className="btn-ghost px-5 py-2.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Accept a ?link= code after registration; strips the param on success. */
export async function acceptLinkFromUrl(code: string): Promise<boolean> {
  const normalized = code.trim().toLowerCase();
  if (normalized.length !== 6) return false;

  const r = await fetch("/api/auth/link/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: normalized }),
  });
  if (!r.ok) return false;

  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    url.searchParams.delete("link");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }
  return true;
}
