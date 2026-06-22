"use client";

import dynamic from "next/dynamic";
import type { NodeResponse } from "@/lib/client-identity";
import type { MeDetail } from "@/lib/types";
import { fmtCompact, fmtRank } from "@/lib/format";

const Globe = dynamic(() => import("../Globe"), { ssr: false });

/** Floating chip — only shown on md+ (would crowd the small mobile globe). */
function Chip({
  value,
  label,
  accent,
  className,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={`chip absolute hidden max-w-[42%] md:block ${className}`}>
      <div className={`truncate text-xl font-semibold tabular-nums ${accent ? "text-purple" : "text-fg"}`}>
        {value}
      </div>
      <div className="label mt-0.5 truncate">{label}</div>
    </div>
  );
}

/** Compact inline stat for the mobile row under the globe. */
function MobileStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center">
      <span className={`text-lg font-semibold tabular-nums ${accent ? "text-purple" : "text-fg"}`}>{value}</span>
      <span className="label mt-0.5 text-center text-[10px] leading-tight">{label}</span>
    </div>
  );
}

export default function Hero({ node, me }: { node: NodeResponse | null; me: MeDetail | null }) {
  // Live (polled) metrics from /api/me take precedence over the register snapshot.
  const m = me?.metrics ?? node?.metrics;
  return (
    <section className="relative flex min-h-dvh flex-col items-center overflow-x-clip px-4 pt-24 pb-12">
      {/* headline */}
      <p className="label mb-6 opacity-60">one link · one growing web</p>
      <h1 className="text-center text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl md:text-7xl">
        Watch your link
        <br />
        <span className="text-purple">reach the world.</span>
      </h1>
      <p className="mt-6 max-w-xl text-center text-base leading-relaxed text-muted">
        Share one link and watch it travel — every click adds a node, every node a new branch.
        See your reach spread across the globe in real time. Anonymous by default, no sign-up.
      </p>

      {/* globe stage — Canvas overflows the box so arcs/glow that bow past the
          sphere edge aren't clipped; the camera (pulled back in Globe) keeps the
          sphere itself centered within the visible area. */}
      <div className="relative mt-10 aspect-square w-full max-w-xl">
        <div className="glow-purple pointer-events-none absolute inset-[12%] rounded-full" />
        {/* Canvas overflows on md+ (so arcs aren't clipped); on mobile it stays inside
            the box to avoid forcing horizontal page scroll. */}
        <div className="pointer-events-auto absolute inset-0 md:inset-[-15%]">
          <Globe you={me?.you ?? null} incoming={me?.incoming} outgoing={me?.outgoing} />
        </div>

        {m && (
          <>
            <Chip className="left-0 top-[28%]" value={fmtCompact(m.reach)} label="in your web" />
            <Chip className="right-0 top-[20%]" value={fmtCompact(m.countries)} label="countries reached" />
            <Chip className="bottom-[16%] left-[4%]" value={fmtCompact(m.maxDepth)} label="degrees deep" />
            <Chip className="bottom-[10%] right-[2%]" value={fmtRank(me?.rank?.rank)} label="global rank" accent />
          </>
        )}
      </div>

      {/* mobile stat row — chips are hidden on small screens to keep the globe clean */}
      {m && (
        <div className="mt-4 grid w-full max-w-sm grid-cols-4 gap-2 md:hidden">
          <MobileStat value={fmtCompact(m.reach)} label="in your web" />
          <MobileStat value={fmtCompact(m.countries)} label="countries" />
          <MobileStat value={fmtCompact(m.maxDepth)} label="degrees" />
          <MobileStat value={fmtRank(me?.rank?.rank)} label="rank" accent />
        </div>
      )}

      {/* legend */}
      <div className="chip mt-2 flex items-center gap-5 !rounded-full !py-2 text-sm">
        <span className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--purple)" }} /> people you brought
        </span>
        <span className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: "var(--blue)" }} /> who brought you
        </span>
      </div>

      {/* CTAs */}
      <div className="mt-6 flex items-center gap-3">
        <a href="#share" className="btn-primary px-6 py-3 text-sm">
          Share your link →
        </a>
        <a href="#network" className="btn-ghost px-6 py-3 text-sm">
          See your network
        </a>
      </div>
      <p className="label mt-4 opacity-50">drag the globe to explore · auto-rotating</p>
    </section>
  );
}
