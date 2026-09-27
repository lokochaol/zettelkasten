"use client";

import { useRef, useState, useTransition } from "react";
import { previewCsvAction, importCsvAction, type CsvPreview } from "@/app/money/actions";
import { useI18n } from "@/lib/i18n/LocaleProvider";
import type { ColumnMapping } from "@/lib/csvImport";

/**
 * Importing a statement, with the preview in front of the write.
 *
 * The file is decoded in the browser rather than shipped as bytes: half
 * of Japanese issuers still export Shift-JIS, and the browser already has
 * the decoders. UTF-8 is tried first in fatal mode — Shift-JIS text is
 * not valid UTF-8, so the failure is a definite answer rather than a
 * guess at the encoding.
 */
export function CsvImportPanel({ categories, onImported }: { categories: string[]; onImported: () => void }) {
  const { t } = useI18n();
  const [profileName, setProfileName] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [rowCategory, setRowCategory] = useState<Record<string, string>>({});
  const [replaceManual, setReplaceManual] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    const buffer = await file.arrayBuffer();
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      decoded = new TextDecoder("shift_jis").decode(buffer);
    }
    setText(decoded);
    if (!profileName) setProfileName(file.name.replace(/\.[^.]+$/, ""));
    runPreview(decoded);
  }

  function runPreview(source = text, overrides?: Partial<ColumnMapping>) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await previewCsvAction(source, profileName || "明細", overrides);
      if ("error" in res) {
        setError(res.error);
        setPreview(null);
        return;
      }
      setPreview(res);
      setRowCategory(
        Object.fromEntries(res.candidates.filter((c) => !c.problem).map((c) => [c.externalKey, c.category])),
      );
      setReplaceManual({});
    });
  }

  function doImport() {
    if (!preview) return;
    const selections = preview.candidates
      .filter((c) => !c.problem && !c.alreadyImported)
      .map((c) => ({
        externalKey: c.externalKey,
        dateKey: c.dateKey,
        amountYen: c.amountYen,
        memo: c.memo,
        category: rowCategory[c.externalKey] || "その他",
        replacesManualId: replaceManual[c.externalKey] ? c.manualMatchId : null,
      }));
    // What the owner categorised by hand becomes a rule, keyed on the
    // description, so the next statement arrives mostly sorted.
    const learnedRules = preview.candidates
      .filter((c) => !c.problem && c.memo && rowCategory[c.externalKey] && rowCategory[c.externalKey] !== c.category)
      .map((c) => ({ keyword: c.memo, category: rowCategory[c.externalKey] }));

    startTransition(async () => {
      const r = await importCsvAction(profileName || "明細", preview.mapping, selections, learnedRules);
      setResult(t.money.importResult(r.imported, r.replaced, r.skipped));
      setPreview(null);
      setText("");
      onImported();
    });
  }

  const usable = preview?.candidates.filter((c) => !c.problem) ?? [];
  const importable = usable.filter((c) => !c.alreadyImported);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <p className="font-mono text-[9.5px] tracking-wider text-ink-faint uppercase">{t.money.importHeading}</p>
      <p className="text-[11px] leading-relaxed text-ink-soft">{t.money.importIntro}</p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          placeholder={t.money.profileNamePlaceholder}
          className="w-44 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent focus:outline-none"
        />
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-line-strong px-3 py-1.5 font-mono text-[11px] text-ink-soft hover:border-accent hover:text-accent"
        >
          {t.money.orChooseFile}
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() && runPreview()}
        placeholder={t.money.pasteLabel}
        rows={3}
        className="w-full rounded-md border border-line bg-surface px-2.5 py-2 font-mono text-[10.5px] text-ink focus:border-accent focus:outline-none"
      />

      {error && <p className="text-[10.5px] text-accent">{error}</p>}
      {result && <p className="font-mono text-[10.5px] text-accent">{result}</p>}

      {preview && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["dateColumn", t.money.columnDate],
                ["amountColumn", t.money.columnAmount],
                ["memoColumn", t.money.columnMemo],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] text-ink-faint">{label}</span>
                <select
                  value={preview.mapping[key]}
                  onChange={(e) => runPreview(text, { ...preview.mapping, [key]: e.target.value })}
                  className="rounded border border-line bg-surface px-1.5 py-1 text-[11px] text-ink focus:outline-none"
                >
                  {preview.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={preview.mapping.amountIsNegativeForSpending}
                onChange={(e) =>
                  runPreview(text, { ...preview.mapping, amountIsNegativeForSpending: e.target.checked })
                }
                className="h-3.5 w-3.5 accent-[var(--color-accent)]"
              />
              <span className="font-mono text-[9.5px] text-ink-soft">{t.money.negativeIsSpending}</span>
            </label>
          </div>

          <p className="font-mono text-[10px] text-ink-soft">
            {t.money.previewHeading(usable.length, preview.candidates.length)}
          </p>

          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {preview.candidates.map((c, i) => (
              <li
                key={c.externalKey || `problem-${i}`}
                className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 ${
                  c.problem ? "border-line bg-surface-alt opacity-60" : "border-line"
                }`}
              >
                <span className="font-mono text-[10px] text-ink-faint">{c.dateKey || "—"}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{c.memo || "—"}</span>
                {c.problem ? (
                  <span className="font-mono text-[9px] text-ink-faint">{c.problem}</span>
                ) : (
                  <>
                    <span className="font-mono text-[11px] text-ink">¥{c.amountYen.toLocaleString()}</span>
                    {c.alreadyImported ? (
                      <span className="font-mono text-[9px] text-ink-faint">{t.money.alreadyImported}</span>
                    ) : (
                      <>
                        <select
                          value={rowCategory[c.externalKey] ?? ""}
                          onChange={(e) => setRowCategory((prev) => ({ ...prev, [c.externalKey]: e.target.value }))}
                          className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-ink focus:outline-none"
                        >
                          <option value="">—</option>
                          {categories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                        {c.manualMatchId && (
                          <label className="flex items-center gap-1" title={t.money.manualMatch}>
                            <input
                              type="checkbox"
                              checked={replaceManual[c.externalKey] ?? false}
                              onChange={(e) =>
                                setReplaceManual((prev) => ({ ...prev, [c.externalKey]: e.target.checked }))
                              }
                              className="h-3 w-3 accent-[var(--color-accent)]"
                            />
                            <span className="font-mono text-[9px] text-accent">{t.money.replaceManual}</span>
                          </label>
                        )}
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          <button
            onClick={doImport}
            disabled={pending || importable.length === 0}
            className="btn-sheen w-fit rounded-md bg-accent px-3.5 py-2 font-mono text-[11px] font-semibold text-on-accent disabled:opacity-40"
          >
            {pending ? t.money.importing : t.money.doImport(importable.length)}
          </button>
        </>
      )}
    </section>
  );
}
