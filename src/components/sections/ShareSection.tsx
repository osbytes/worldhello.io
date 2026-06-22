"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { shareUrl, intentUrl, nativeShare, type Platform } from "@/lib/share";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "x", label: "X" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "telegram", label: "Telegram" },
  { id: "facebook", label: "Facebook" },
];

export default function ShareSection({ code, fpLabel }: { code: string; fpLabel: string }) {
  const url = shareUrl(code);
  const display = url.replace(/^https?:\/\//, "");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: "#c4b5fd", light: "#0a0a0f" } })
      .then(setQr)
      .catch(() => {});
  }, [url]);

  const copy = async () => {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
    <section id="share" className="mx-auto w-full max-w-6xl overflow-x-clip px-6 py-24">
      <h2 className="text-4xl font-bold tracking-tight">Share your link</h2>
      <p className="mt-3 max-w-2xl text-muted">
        Every click grows your web. Your link carries your device fingerprint — no sign-up, no account.
      </p>

      <div className="mt-10 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        {/* link + platforms */}
        <div className="card p-6">
          <div className="label">Your referral link</div>
          <div className="mt-3 flex gap-3">
            <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm">
              <span className="truncate">{display}</span>
            </div>
            <button onClick={copy} className="btn-primary shrink-0 px-6 py-3 text-sm">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => nativeShare(url)} className="btn-ghost px-4 py-2 text-sm">
              Share…
            </button>
            {PLATFORMS.map((p) => (
              <a key={p.id} href={intentUrl(p.id, url)} target="_blank" rel="noopener noreferrer"
                className="btn-ghost px-4 py-2 text-sm">
                {p.label}
              </a>
            ))}
          </div>
        </div>

        {/* QR */}
        <div className="card flex flex-col items-center justify-center p-6">
          {qr && <img src={qr} alt="QR" className="h-44 w-44 rounded-xl" />}
          <p className="label mt-4">Scan to join your web</p>
        </div>
      </div>

      {/* anonymous / magic link */}
      <div className="card mt-5 p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md border border-purple/40 text-purple">◇</span>
              <h3 className="text-lg font-semibold">Anonymous, by design</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              No names, no accounts, no tracking pixels. This device is recognized by a privacy-preserving
              fingerprint — <span className="font-mono text-purple">{fpLabel}</span>. Optionally link an email to
              carry your web across phone, laptop, and tablet.
            </p>
            <p className="label mt-3 normal-case tracking-normal">device identity · powered by FingerprintJS</p>
          </div>
          {sent ? (
            <p className="text-sm text-purple">Check your inbox ✉️</p>
          ) : (
            <form onSubmit={sendMagic} className="flex w-full max-w-sm flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-muted/50 focus:border-purple/50"
                />
                <button className="btn-ghost whitespace-nowrap border-purple/40 px-4 py-3 text-sm text-purple">
                  Send magic link
                </button>
              </div>
              <p className="label normal-case tracking-normal">Link devices to never lose your network →</p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
