import { getDictionary } from "@/lib/i18n/dictionary";
import type { DomainError } from "@/lib/errors";
import type { ZoteroApiError } from "@/lib/zotero";
import type { DiscoveryErrorCode } from "@/lib/discovery";
import type { Locale } from "@/lib/i18n/types";
import type { AiJsonError } from "@/lib/aiJson";

/**
 * Translates a DomainError's stable `code` (+ params) into user-facing text
 * in the given locale, using the `errors` namespace of the dictionary. This
 * is the one place that needs to know each code's specific param shape —
 * every throw site in the lib layer only ever deals in `code`/`params`.
 */
export function translateDomainError(locale: Locale, error: DomainError): string {
  const dict = getDictionary(locale).errors;
  const [a, b] = error.params;
  switch (error.code) {
    case "keywordRequired":
      return dict.keywordRequired;
    case "permanentNoteNotFound":
      return dict.permanentNoteNotFound;
    case "indexKeywordTaken":
      return dict.indexKeywordTaken(String(a));
    case "indexEntryNotFound":
      return dict.indexEntryNotFound;
    case "quickNoteSelectionRequired":
      return dict.quickNoteSelectionRequired;
    case "permanentNoteDraftRequired":
      return dict.permanentNoteDraftRequired;
    case "draftInvalid":
      return dict.draftInvalid(String(a), String(b));
    case "orderKeyConflict":
      return dict.orderKeyConflict;
    case "quickNotesNotFound":
      return dict.quickNotesNotFound;
    case "quickNotesAlreadyPromoted":
      return dict.quickNotesAlreadyPromoted;
    case "linkedPermanentNoteNotFound":
      return dict.linkedPermanentNoteNotFound;
    case "linkedIndexEntryNotFound":
      return dict.linkedIndexEntryNotFound;
    case "literatureMemoNotFound":
      return dict.literatureMemoNotFound;
    case "quickNoteNotFound":
      return dict.quickNoteNotFound;
    case "linkNotFound":
      return dict.linkNotFound;
    case "discoveryCandidateNotFound":
      return dict.discoveryCandidateNotFound;
    case "mealPlanNotFound":
      return dict.mealPlanNotFound;
    case "inventoryInvalid":
      return dict.inventoryInvalid;
    case "inventoryNotFound":
      return dict.inventoryNotFound;
    case "trainingPreferenceInvalid":
      return dict.trainingPreferenceInvalid;
    case "trainingSessionInvalid":
      return dict.trainingSessionInvalid;
    case "trainingSessionNotFound":
      return dict.trainingSessionNotFound;
    case "trainingWeekPast":
      return dict.trainingWeekPast;
    case "purchaseListInvalid":
      return dict.purchaseListInvalid;
    case "purchaseListNoMeals":
      return dict.purchaseListNoMeals;
    case "mealChatInvalid":
      return dict.mealChatInvalid;
    case "mealChatProposalGone":
      return dict.mealChatProposalGone;
    case "timeBlockInvalid":
      return dict.timeBlockInvalid;
    case "timeBlockNotFound":
      return dict.timeBlockNotFound;
    case "moneyPlanInvalid":
      return dict.moneyPlanInvalid;
    case "moneyPlanNotFound":
      return dict.moneyPlanNotFound;
    case "projectNotFound":
      return dict.projectNotFound;
    case "projectNameRequired":
      return dict.projectNameRequired;
    case "projectGoalInvalid":
      return dict.projectGoalInvalid(String(a));
    default:
      return error.message;
  }
}

/** Same idea as translateDomainError, for a discovery batch run's recorded
 * failure (DiscoveryProviderError's code/status, persisted on
 * DiscoveryRunStatus — see src/lib/discovery.ts). */
export function translateDiscoveryError(locale: Locale, code: DiscoveryErrorCode, status: number | null): string {
  const dict = getDictionary(locale).discovery;
  switch (code) {
    case "authError":
      return dict.runErrorAuth;
    case "rateLimitError":
      return dict.runErrorRateLimit;
    case "apiError":
      return dict.runErrorGeneric(status ?? 0);
    default:
      return dict.runErrorUnknown;
  }
}

/** Same idea as translateDomainError, for ZoteroApiError (which lives
 * outside the ConflictError/NotFoundError/ValidationError hierarchy since
 * it's an external-API error, not a domain-invariant one). */
export function translateZoteroError(locale: Locale, error: ZoteroApiError): string {
  const dict = getDictionary(locale).errors;
  switch (error.code) {
    case "zoteroApiError":
      return dict.zoteroApiError(Number(error.params[0]), String(error.params[1]));
    case "zoteroTitleRequired":
      return dict.zoteroTitleRequired;
    case "zoteroWriteForbidden":
      return dict.zoteroWriteForbidden;
    case "zoteroCreateFailed":
      return dict.zoteroCreateFailed;
    default:
      return error.message;
  }
}

/** What to tell the owner when their AI provider couldn't produce a usable
 * answer — shared by every feature that runs on their key. The provider's
 * own detail is kept: one user, their own key, and "couldn't read the
 * reply" with nothing further isn't something they can act on. */
export function translateAiError(locale: Locale, e: AiJsonError): string {
  const meals = getDictionary(locale).meals;
  if (e.code === "notConfigured") return meals.errorNoAiKey;
  const byCode: Record<string, string> = {
    authError: meals.errorAuth,
    rateLimitError: meals.errorRateLimit,
    invalidResponse: meals.errorBadResponse,
    truncated: meals.errorTruncated,
    apiError: meals.errorApi,
  };
  return `${byCode[e.code] ?? meals.errorApi}${meals.errorDetail(e.message)}`;
}
