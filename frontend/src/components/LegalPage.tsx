import type { ReactNode } from "react";
import Link from "next/link";

/**
 * The frame for the privacy policy and terms: public pages (exempt from the
 * session gate in proxy.ts) that Google's OAuth consent screen links to.
 * The service is called "hibino" here, where a page has to name it; the
 * app itself keeps "／" as its label.
 */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-16">
      <article className="flex w-full max-w-[720px] flex-col gap-6 text-[13.5px] leading-relaxed text-ink">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[11px] tracking-wider text-ink-faint">hibino</p>
          <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="font-mono text-[11px] text-ink-soft">{updated}</p>
        </div>
        {children}
        <nav className="flex gap-4 border-t border-line pt-4 font-mono text-[11px] text-ink-soft">
          <Link href="/guide" className="hover:text-accent">
            /guide
          </Link>
          <Link href="/privacy" className="hover:text-accent">
            /privacy
          </Link>
          <Link href="/terms" className="hover:text-accent">
            /terms
          </Link>
        </nav>
      </article>
    </main>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[15px] font-bold">{heading}</h2>
      {children}
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-soft [overflow-wrap:anywhere]">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
