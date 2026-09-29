"use client";

import { useRouter } from "next/navigation";
import { navigateWithViewTransition } from "@/lib/viewTransition";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/** The always-visible nav action on 走り書き that fires the /dash-off → /zettelkasten transition (§5) — never automatic/implicit. */
export function ZettelkastenNavButton() {
  const router = useRouter();
  const { t } = useI18n();
  return (
    <button
      onClick={() => navigateWithViewTransition(router, "/zettelkasten")}
      className="rounded-full border border-line-strong px-3 py-1.5 font-mono text-[10.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
    >
      {t.nav.toZettelkasten} <span className="text-accent">→</span>
    </button>
  );
}
