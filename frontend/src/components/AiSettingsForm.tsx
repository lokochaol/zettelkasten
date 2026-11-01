"use client";

import { useState, useTransition } from "react";
import { HudFrame } from "@/components/HudFrame";
import { Spinner } from "@/components/LoadingSpinner";
import { removeAiSettingsAction, saveAiSettingsAction } from "@/app/settings/actions";
import type { AiCredentialSummary } from "@/lib/aiCredentials";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import { localeTag } from "@/lib/i18n/dictionary";
import type { Locale } from "@/lib/i18n/types";

function formatDate(date: Date, locale: Locale) {
  return date.toLocaleString(localeTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Mirrors the Prisma AiProvider enum's string values as plain literals —
// this file is a Client Component and must not import anything that pulls
// in @/lib/db (aiCredentials.ts does, for its Prisma client access).
type AiProviderValue = "ANTHROPIC" | "OPENAI" | "GOOGLE";
const AI_PROVIDERS: AiProviderValue[] = ["ANTHROPIC", "OPENAI", "GOOGLE"];

const PROVIDER_KEY_URL: Record<AiProviderValue, string> = {
  ANTHROPIC: "https://console.anthropic.com/settings/keys",
  OPENAI: "https://platform.openai.com/api-keys",
  GOOGLE: "https://aistudio.google.com/apikey",
};

export function AiSettingsForm({ initial }: { initial: AiCredentialSummary | null }) {
  const { t, locale } = useI18n();
  const [summary, setSummary] = useState(initial);
  const [provider, setProvider] = useState<AiProviderValue>((initial?.provider as AiProviderValue) ?? "ANTHROPIC");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const providerLabel: Record<AiProviderValue, string> = {
    ANTHROPIC: t.settings.aiProviderAnthropic,
    OPENAI: t.settings.aiProviderOpenAi,
    GOOGLE: t.settings.aiProviderGoogle,
  };

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveAiSettingsAction({ provider, apiKey });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setApiKey("");
      setSummary({ provider, updatedAt: new Date() });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  function disconnect() {
    startTransition(async () => {
      await removeAiSettingsAction();
      setSummary(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <div className="flex items-center justify-between rounded-lg border border-line bg-surface-alt px-3 py-2">
          <span className="font-mono text-[11px] text-ink">
            {t.settings.aiConnectedSummary(providerLabel[summary.provider])}
            <span className="ml-2 text-ink-faint">{t.settings.lastUpdated(formatDate(summary.updatedAt, locale))}</span>
          </span>
          <button
            onClick={disconnect}
            disabled={pending}
            className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent disabled:opacity-50"
          >
            {t.settings.aiDisconnect}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">
          {t.settings.aiProviderLabel}
        </label>
        <div className="flex gap-2">
          {AI_PROVIDERS.map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`rounded-full border px-3 py-1 font-mono text-[10.5px] transition-colors ${
                provider === p
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-ink-soft hover:border-line-strong"
              }`}
            >
              {providerLabel[p]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-ink-soft">
        <a href={PROVIDER_KEY_URL[provider]} target="_blank" rel="noreferrer" className="text-accent underline">
          {PROVIDER_KEY_URL[provider].replace("https://", "")}
        </a>{" "}
        {t.settings.aiApiKeyHelp}
      </p>

      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">
          {t.settings.aiApiKeyLabel}
        </label>
        <HudFrame active={false} innerClassName="rounded-lg px-3 py-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={summary ? t.settings.aiApiKeyPlaceholderExisting : t.settings.aiApiKeyPlaceholderNew}
            autoComplete="off"
            className="w-full bg-transparent text-xs text-ink placeholder:text-ink-soft focus:outline-none"
          />
        </HudFrame>
      </div>

      {error && <p className="font-mono text-[10.5px] text-alert">{error}</p>}

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={pending || (!summary && !apiKey.trim())}
          className="btn-sheen flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50"
        >
          {pending && <Spinner size="xs" />}
          {pending ? t.common.saving : saved ? t.common.saved : t.common.save}
        </button>
      </div>
    </div>
  );
}
