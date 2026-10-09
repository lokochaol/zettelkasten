import { googleSignIn } from "@/app/actions";
import { safeReturnPath } from "@/lib/returnPath";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function SignInPage(props: PageProps<"/signin">) {
  const { from } = await props.searchParams;
  const dict = getDictionary(await getLocale());
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-10 text-center shadow-sm">
        <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-ink">{dict.signin.title}</h1>
        <p className="mb-8 text-sm leading-relaxed text-ink-soft">{dict.signin.tagline}</p>
        <form action={googleSignIn}>
          {typeof from === "string" && <input type="hidden" name="from" value={safeReturnPath(from)} />}
          <button
            type="submit"
            className="btn-sheen inline-flex w-full items-center justify-center gap-3 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-on-accent transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
          >
            <GoogleIcon />
            {dict.signin.googleButton}
          </button>
        </form>
      </div>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.95a9 9 0 0 0 0 8.08l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.96l3 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}
