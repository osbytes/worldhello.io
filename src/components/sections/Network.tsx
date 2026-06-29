"use client";

import type { NodeResponse } from "@/lib/client-identity";
import type { MeDetail } from "@/lib/types";
import { fmtCompact, fmtRank } from "@/lib/format";

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  accent?: "purple" | "blue";
}) {
  const color = accent === "purple" ? "text-purple" : accent === "blue" ? "text-blue" : "text-fg";
  return (
    <div className="card min-w-0 p-5">
      <div className="label truncate">{label}</div>
      <div className={`mt-3 truncate text-3xl font-bold tabular-nums sm:text-4xl ${color}`}>{value}</div>
      <div className="mt-2 text-sm text-muted">{sub}</div>
    </div>
  );
}

/** Compact chain-position strip: where you sit between who shared with you and who you reached. */
function ChainStrip({ node, m }: { node: NodeResponse | null; m?: { direct: number; reach: number } }) {
  const direct = m?.direct ?? 0;
  const reach = m?.reach ?? 0;

  const Node = ({
    glyph,
    title,
    shortTitle,
    state,
  }: {
    glyph: string;
    title: string;
    shortTitle?: string;
    state: "dim" | "blue" | "you" | "purple";
  }) => {
    const ring =
      state === "you"
        ? "border-purple bg-purple/20 text-fg shadow-[0_0_24px_rgba(167,139,250,0.4)]"
        : state === "blue"
          ? "border-blue/60 text-blue"
          : state === "purple"
            ? "border-purple/60 text-purple"
            : "border-white/15 text-muted";
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center text-center">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold sm:h-11 sm:w-11 sm:text-xs ${ring}`}
        >
          {glyph}
        </div>
        <div
          className={`mt-1.5 max-w-full px-0.5 text-[10px] leading-tight sm:mt-2 sm:text-[11px] ${state === "you" ? "text-purple" : "text-muted"}`}
        >
          <span className="sm:hidden">{shortTitle ?? title}</span>
          <span className="hidden sm:inline">{title}</span>
        </div>
      </div>
    );
  };
  const Link = ({ color }: { color: "blue" | "purple" }) => (
    <div
      className="mx-0.5 mb-5 h-px min-w-2 flex-1 self-center sm:mx-1 sm:mb-6 sm:min-w-4"
      style={{ background: `linear-gradient(90deg, transparent, var(--${color}), transparent)` }}
    />
  );

  return (
    <div className="card mt-4 p-4 sm:p-6">
      <div className="label mb-4">where you sit in the web</div>
      <div className="flex min-w-0 items-start justify-between">
        <Node glyph="↗" title="shared with you" shortTitle="from" state="blue" />
        <Link color="blue" />
        <Node glyph="YOU" title="this device" shortTitle="you" state="you" />
        <Link color="purple" />
        <Node glyph={`×${direct}`} title="you shared" shortTitle="out" state="purple" />
        <Link color="purple" />
        <Node glyph={fmtCompact(reach)} title="downstream" shortTitle="reach" state="dim" />
      </div>
    </div>
  );
}

export default function Network({ node, me }: { node: NodeResponse | null; me: MeDetail | null }) {
  const m = me?.metrics ?? node?.metrics;
  return (
    <section id="network" className="mx-auto w-full max-w-6xl overflow-x-clip px-4 py-24 sm:px-6">
      <div className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Your network</h2>
          <p className="mt-2 text-muted">Everyone a single share connected you to — and how far it traveled.</p>
        </div>
        <span className="label shrink-0 opacity-60">updated live</span>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="People reached" value={fmtCompact(m?.reach ?? 0)} sub="connected through your link" />
        <StatCard label="You shared with" value={fmtCompact(m?.direct ?? 0)} sub="people you brought directly" accent="purple" />
        <StatCard label="Chain length" value={fmtCompact(m?.maxDepth ?? 0)} sub="longest path you started" />
        <StatCard label="Countries" value={fmtCompact(m?.countries ?? 0)} sub="distinct countries reached" />
        <StatCard
          label="Global rank"
          value={fmtRank(me?.rank?.rank)}
          sub={me?.rank ? `top ${100 - me.rank.percentile}%` : "—"}
          accent="purple"
        />
      </div>

      <ChainStrip node={node} m={m} />
    </section>
  );
}
