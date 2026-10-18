"use client";

import { useState } from "react";
import { googleSignOut } from "@/app/actions";
import { useI18n } from "@/lib/i18n/LocaleProvider";

/**
 * Signs out and goes to /signin with a full page load, so nothing of the
 * signed-in session lingers in memory.
 *
 * A plain button, not a <form>: HeaderMenu closes on any click inside it,
 * which took the form out of the page before the browser got to submit it —
 * the click did nothing at all. The handler here starts the sign-out during
 * the click itself, and carries on after the menu has gone. Even if the
 * request fails (offline, an expired deploy), the page still goes to
 * /signin rather than looking as if nothing happened.
 */
export function SignOutButton() {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);

  function signOut() {
    setPending(true);
    void googleSignOut()
      .catch(() => {})
      .finally(() => window.location.replace("/signin"));
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="text-xs font-medium tracking-wide text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
    >
      {t.common.signOut}
    </button>
  );
}
