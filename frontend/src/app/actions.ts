"use server";

import { signIn, signOut } from "@/auth";
import { safeReturnPath } from "@/lib/returnPath";

/** Back to the page that sent you to sign in, when it's one of ours. */
export async function googleSignIn(form: FormData) {
  await signIn("google", { redirectTo: safeReturnPath(form.get("from")) });
}

export async function googleSignOut() {
  await signOut({ redirectTo: "/signin" });
}
