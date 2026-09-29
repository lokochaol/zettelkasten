import { PageLoading } from "@/components/LoadingSpinner";
import { getLocale } from "@/lib/i18n/locale";
import { getDictionary } from "@/lib/i18n/dictionary";

export default async function Loading() {
  const dict = getDictionary(await getLocale());
  return <PageLoading label={dict.scratch.loadingLabel} />;
}
