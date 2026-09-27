/** Shared domain error types for the lib layer — mirrors the pattern that
 * originally lived in src/lib/words.ts, now shared across quickNotes,
 * permanentNotes, indexEntries, promotion, and zotero.
 *
 * Each error carries a stable `code` (a key into Dictionary["errors"]) plus
 * any `params` that code's dictionary entry needs, so the lib layer never
 * bakes a translated message into a thrown error — the UI/Server Action
 * boundary is what turns `code` (+ params) into locale-aware text via
 * `translateDomainError` (see src/lib/i18n/errors.ts). `message` is kept as
 * an English, non-localized fallback for logs/debugging only — it must never
 * be shown to the end user. */

export type DomainErrorCode =
  | "keywordRequired"
  | "permanentNoteNotFound"
  | "healthProfileInvalid"
  | "healthProfileMissing"
  | "mealPreferenceInvalid"
  | "mealPlanNotFound"
  | "coopPlanMissing"
  | "coopOrderNotFound"
  | "timeBlockInvalid"
  | "timeBlockNotFound"
  | "expenseInvalid"
  | "expenseNotFound"
  | "healthGoalTooAggressive"
  | "healthMetricInvalid"
  | "permanentNoteTitleRequired"
  | "permanentNoteContentRequired"
  | "indexKeywordTaken"
  | "indexEntryNotFound"
  | "quickNoteSelectionRequired"
  | "permanentNoteDraftRequired"
  | "draftInvalid"
  | "orderKeyConflict"
  | "quickNotesNotFound"
  | "quickNotesAlreadyPromoted"
  | "linkedPermanentNoteNotFound"
  | "linkedIndexEntryNotFound"
  | "literatureMemoNotFound"
  | "quickNoteNotFound"
  | "linkNotFound"
  | "discoveryCandidateNotFound"
  | "projectNotFound"
  | "projectNameRequired"
  | "projectGoalInvalid";

export class DomainError extends Error {
  code: DomainErrorCode;
  params: unknown[];

  constructor(code: DomainErrorCode, message: string, ...params: unknown[]) {
    super(message);
    this.code = code;
    this.params = params;
  }
}

export class ConflictError extends DomainError {}
export class NotFoundError extends DomainError {}
export class ValidationError extends DomainError {}
