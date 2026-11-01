"use client";

import { useState, useTransition } from "react";
import { HudFrame } from "@/components/HudFrame";
import { Spinner } from "@/components/LoadingSpinner";
import { removeZoteroSettingsAction, saveZoteroSettingsAction } from "@/app/settings/actions";
import type { ZoteroCredentialSummary } from "@/lib/zoteroCredentials";
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

export function ZoteroSettingsForm({ initial }: { initial: ZoteroCredentialSummary | null }) {
  const { t, locale } = useI18n();
  const [summary, setSummary] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  const [libraryId, setLibraryId] = useState(initial?.libraryId ?? "");
  const [libraryType, setLibraryType] = useState(initial?.libraryType ?? "user");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveZoteroSettingsAction({ apiKey, libraryId, libraryType });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setApiKey("");
      setSummary({ libraryId, libraryType, updatedAt: new Date() });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });
  }

  function disconnect() {
    startTransition(async () => {
      await removeZoteroSettingsAction();
      setSummary(null);
      setLibraryId("");
      setLibraryType("user");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {summary && (
        <div className="flex items-center justify-between rounded-lg border border-line bg-surface-alt px-3 py-2">
          <span className="font-mono text-[11px] text-ink">
            {t.settings.connectedSummary(summary.libraryId)}（{summary.libraryType === "group" ? t.settings.libraryTypeGroup : t.settings.libraryTypeUser}）
            <span className="ml-2 text-ink-faint">{t.settings.lastUpdated(formatDate(summary.updatedAt, locale))}</span>
          </span>
          <button
            onClick={disconnect}
            disabled={pending}
            className="font-mono text-[10px] text-ink-soft transition-colors hover:text-accent disabled:opacity-50"
          >
            {t.settings.disconnect}
          </button>
        </div>
      )}

      <p className="text-xs text-ink-soft">
        <a
          href="https://www.zotero.org/settings/keys"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          {t.settings.apiKeyHelp1}
        </a>
        {t.settings.apiKeyHelp2}
      </p>

      <LabeledInput
        label={t.settings.apiKeyLabel}
        value={apiKey}
        onChange={setApiKey}
        placeholder={summary ? t.settings.apiKeyPlaceholderExisting : t.settings.apiKeyPlaceholderNew}
        type="password"
      />
      <LabeledInput label={t.settings.libraryIdLabel} value={libraryId} onChange={setLibraryId} placeholder={t.settings.libraryIdPlaceholder} />

      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.settings.libraryTypeLabel}</label>
        <div className="flex gap-2">
          {(["user", "group"] as const).map((lt) => (
            <button
              key={lt}
              onClick={() => setLibraryType(lt)}
              className={`rounded-full border px-3 py-1 font-mono text-[10.5px] transition-colors ${
                libraryType === lt
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-ink-soft hover:border-line-strong"
              }`}
            >
              {lt === "user" ? t.settings.libraryTypeUser : t.settings.libraryTypeGroup}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="font-mono text-[10.5px] text-alert">{error}</p>}

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={pending || !libraryId.trim() || (!summary && !apiKey.trim())}
          className="btn-sheen flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-on-accent transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-50"
        >
          {pending && <Spinner size="xs" />}
          {pending ? t.common.saving : saved ? t.common.saved : t.common.save}
        </button>
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{label}</label>
      <HudFrame active={false} innerClassName="rounded-lg px-3 py-2">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full bg-transparent text-xs text-ink placeholder:text-ink-soft focus:outline-none"
        />
      </HudFrame>
    </div>
  );
}
