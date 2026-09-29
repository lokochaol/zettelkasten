"use client";

import Link from "next/link";
import { GROUPS } from "@/components/PageIndex";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * The index, as a page rather than a dropdown.
 *
 * Shares its entries with the header's index (GROUPS), so the two can't
 * drift: a page added in one place appears in both or in neither.
 */
export function IndexList() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-7">
      {GROUPS.map((group) => (
        <section key={group.titleKey} className="flex flex-col gap-2">
          <p className="font-mono text-[9.5px] tracking-[0.2em] text-ink-faint uppercase">
            {t.pageIndex.groups[group.titleKey]}
          </p>
          <ul className="flex flex-col">
            {group.entries.map((entry) => {
              const page = t.pageIndex.pages[entry.key];
              return (
                <li key={entry.key}>
                  <Link
                    href={entry.href}
                    className="group flex flex-col gap-0.5 border-b border-line py-3 transition-colors hover:border-accent"
                  >
                    <span className="flex items-baseline gap-3">
                      <span className="font-mono text-[15px] font-bold text-ink transition-colors group-hover:text-accent">
                        {entry.href}
                      </span>
                      <span className="text-[11.5px] text-ink-soft">{page.name}</span>
                    </span>
                    <span className="text-[11.5px] leading-snug text-ink-soft">{page.note}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
