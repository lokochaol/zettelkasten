import Link from "next/link";
import type { ReactNode } from "react";
import { HudFrame } from "@/components/HudFrame";

/**
 * The building blocks both language versions of the guide are made of.
 *
 * The two versions are separate files because they are separate pieces of
 * writing, not a string table — but their shape has to stay the same, and
 * keeping the shape here is what stops one of them quietly growing a
 * section the other doesn't have.
 */

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-soft uppercase">
      <span className="text-accent">{"//"}</span> {children}
    </p>
  );
}

export function DiagramFrame({ children }: { children: ReactNode }) {
  return (
    <HudFrame active={false} innerClassName="flex items-center justify-center rounded-xl px-6 py-8">
      {children}
    </HudFrame>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <p className="max-w-[62ch] text-sm leading-relaxed text-ink-soft">{children}</p>;
}

/** A top-level part of the guide. `id` is what the contents list links to. */
export function Chapter({
  id,
  kicker,
  title,
  intro,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-8 flex-col gap-8 border-t border-line pt-12">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-[10.5px] tracking-[0.25em] text-accent uppercase">{kicker}</p>
        <h2 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h2>
        {intro && <Prose>{intro}</Prose>}
      </div>
      {children}
    </section>
  );
}

/** One page of the app: its address (a real link, for someone signed in),
 * its name, and what it's for. */
export function PageSection({
  id,
  path,
  name,
  lead,
  children,
}: {
  id: string;
  path: string;
  name: string;
  lead: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-8 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <p className="flex items-baseline gap-3">
          <Link href={path} className="font-mono text-lg font-bold text-ink transition-colors hover:text-accent">
            {path}
          </Link>
          <span className="text-sm text-ink-soft">{name}</span>
        </p>
        <Prose>{lead}</Prose>
      </div>
      {children}
    </section>
  );
}

/** The things you do on a page, as a short list — what to press, what
 * comes back, and anything that isn't obvious from the screen. */
export function Points({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.title} className="flex flex-col gap-1 rounded-lg border border-line bg-surface-alt px-4 py-3">
          <p className="text-[13px] font-semibold text-ink">{item.title}</p>
          <p className="text-xs leading-relaxed text-ink-soft">{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Numbered steps, for things done in order. */
export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((step, i) => (
        <li key={step.title} className="flex gap-4 rounded-lg border border-line bg-surface-alt p-4">
          <span className="shrink-0 font-mono text-xs font-bold text-accent">{String(i + 1).padStart(2, "0")}</span>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-ink">{step.title}</p>
            <p className="text-xs leading-relaxed text-ink-soft">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** How often something happens, with what gets done at that pace. */
export function Rhythm({ columns }: { columns: { label: string; items: string[] }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {columns.map((col) => (
        <div key={col.label} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
          <p className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-accent uppercase">{col.label}</p>
          <ul className="flex flex-col gap-1.5">
            {col.items.map((item) => (
              <li key={item} className="text-xs leading-relaxed text-ink-soft">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** A two-column reference table (symbol → meaning, feature → what it needs). */
export function KeyTable({ rows, mono = false }: { rows: [ReactNode, ReactNode][]; mono?: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([key, value], i) => (
            <tr key={i} className="border-b border-line last:border-b-0">
              <td className={`w-32 bg-surface-alt px-3 py-2 align-top text-ink ${mono ? "font-mono font-bold" : "font-semibold"}`}>
                {key}
              </td>
              <td className="px-3 py-2 leading-relaxed text-ink-soft">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The contents list at the top. Anchors, not routes: everything is on
 * this one page, which is what makes it readable start to finish. */
export function Contents({ heading, items }: { heading: string; items: { id: string; label: string }[] }) {
  return (
    <nav className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <p className="font-mono text-[10.5px] font-semibold tracking-[0.2em] text-ink-faint uppercase">{heading}</p>
      <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {items.map((item, i) => (
          <li key={item.id} className="flex gap-2 text-xs">
            <span className="font-mono text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
            <a href={`#${item.id}`} className="text-ink-soft transition-colors hover:text-accent">
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface-alt px-1.5 py-0.5 font-mono text-[11px] text-ink">{children}</code>;
}
