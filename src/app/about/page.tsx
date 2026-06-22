import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — worldhello.io",
  description: "Why worldhello exists, and the privacy-preserving techniques behind it.",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 text-muted leading-relaxed">{children}</div>
    </section>
  );
}

function Technique({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="font-semibold text-fg">{title}</div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}

export default function About() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <Link href="/" className="label opacity-70 hover:opacity-100">
        ← back to the globe
      </Link>

      <h1 className="mt-8 text-5xl font-bold tracking-tight">
        The shape of <span className="text-purple">connection.</span>
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-muted">
        worldhello is a single link that grows. Share it, and every person who joins through you — and
        everyone they bring — becomes part of a living web you can watch travel across the planet in real
        time. It&apos;s a small experiment in seeing something usually invisible: the chain of who brought
        who.
      </p>

      <Section title="Why it exists">
        <p>
          Most of the internet measures you. Pixels, profiles, ad IDs — built to follow a person across the
          web and tie everything back to a name. worldhello is the opposite bet: that you can build
          something genuinely social and viral <em>without</em> knowing who anyone is. No account, no
          name, no email required. Just the shape of how people reach each other.
        </p>
        <p>
          The idea rides on an old one — that everyone alive is roughly six handshakes apart. Every link
          you share is one of those handshakes, made visible.
        </p>
      </Section>

      <Section title="How your privacy is preserved">
        <p>These aren&apos;t promises in a policy — they&apos;re how the system is actually built:</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Technique title="Anonymous by default">
            No sign-up, no name, no email. A device joins and participates fully without ever identifying a
            person. Email is optional and only used to link your own devices together.
          </Technique>
          <Technique title="Device identity, not personal identity">
            You&apos;re recognized by a random per-device ID plus a privacy-preserving fingerprint — enough
            to keep <em>your</em> web yours across visits, never enough to know who you are.
          </Technique>
          <Technique title="No raw identifiers stored">
            Fingerprints and IP addresses are never stored in the clear. They&apos;re passed through a
            keyed one-way hash, so the database holds opaque tokens that can&apos;t be reversed back to a
            device or network.
          </Technique>
          <Technique title="Coarse location, never asked">
            The globe places you at an approximate, jittered city-level point derived from your connection —
            never your precise location, and you are never prompted for it. Precise placement is strictly
            opt-in.
          </Technique>
          <Technique title="No tracking pixels">
            There are no third-party ad pixels, no cross-site trackers, no behavioral profiling. The only
            data captured is the shape of the referral graph itself.
          </Technique>
          <Technique title="Minimal, auditable footprint">
            Each node stores only what the visualization needs: a share code, a referrer link, a coarse
            location, and a few counts. Sensitive signals live in a separate append-only table that can be
            dropped without affecting the web.
          </Technique>
          <Technique title="Immutable, honest chains">
            Who referred you is written once and never rewritten. No silent re-parenting, no inflating the
            graph — the connections you see are the connections that happened.
          </Technique>
          <Technique title="Bots kept out of the picture">
            Automated traffic, crawlers, and link-preview bots are detected and excluded from the network,
            so reach numbers reflect real people, not scripts.
          </Technique>
        </div>
      </Section>

      <Section title="Open source">
        <p>
          worldhello is built in the open. The privacy claims above are verifiable because the code that
          makes them is public — featured on{" "}
          <a
            href="https://www.osbytes.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple underline underline-offset-2"
          >
            osbytes
          </a>
          .
        </p>
      </Section>

      <div className="mt-16">
        <Link href="/#share" className="btn-primary px-6 py-3 text-sm">
          Get your link →
        </Link>
      </div>
    </main>
  );
}
