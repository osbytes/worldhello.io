"use client";

import { siteHost } from "@/lib/site";

/** The worldhello globe mark — wireframe sphere with blue (incoming) + purple
 *  (outgoing) arcs and a you-node. Matches app/icon.svg. */
function LogoMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" fill="none" aria-hidden className="shrink-0">
      <rect x="0.5" y="0.5" width="63" height="63" rx="13.5" fill="#0a0a0f" stroke="#a78bfa" strokeOpacity="0.35" />
      <circle cx="32" cy="32" r="18" stroke="#3a3a52" strokeWidth="1.2" />
      <ellipse cx="32" cy="32" rx="8" ry="18" stroke="#3a3a52" strokeWidth="1" opacity="0.7" />
      <ellipse cx="32" cy="32" rx="18" ry="7" stroke="#3a3a52" strokeWidth="1" opacity="0.7" />
      <path d="M16 42 C 20 26, 36 18, 46 22" stroke="#5b9dff" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M44 20 C 52 26, 50 38, 42 44" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="44" cy="21" r="4.5" fill="#a78bfa" fillOpacity="0.25" />
      <circle cx="44" cy="21" r="2.4" fill="#ffffff" />
      <circle cx="17" cy="42" r="1.6" fill="#5b9dff" />
      <circle cx="42" cy="44" r="1.6" fill="#a78bfa" />
    </svg>
  );
}

export default function Header({ fpLabel }: { fpLabel: string }) {
  const site = siteHost(typeof window !== "undefined" ? window.location.origin : "");

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-sm">
      <a href="#" className="flex items-center gap-2.5">
        <LogoMark />
        {site ? <span className="text-base font-semibold">{site}</span> : null}
      </a>
      <div className="flex items-center gap-3">
        <span className="chip hidden items-center gap-2 !rounded-full !px-3 !py-1.5 font-mono text-xs text-muted sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-blue" /> {fpLabel}
        </span>
        <a href="#share" className="btn-primary px-4 py-2 text-sm">
          Get your link
        </a>
      </div>
    </header>
  );
}
