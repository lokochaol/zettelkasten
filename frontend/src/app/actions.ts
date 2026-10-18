"use server";

import { signIn, signOut } from "@/auth";
import { safeReturnPath } from "@/lib/returnPath";

/** Back to the page that sent you to sign in, when it's one of ours. */
export async function googleSignIn(form: FormData) {
  await signIn("google", { redirectTo: safeReturnPath(form.get("from")) });
}

/** Clears the session and leaves the navigation to the caller (see
 * SignOutButton): the button sits in a menu that closes — and unmounts —
 * on the same click, so nothing on the page is left to follow a redirect. */
export async function googleSignOut() {
  await signOut({ redirect: false });
}
