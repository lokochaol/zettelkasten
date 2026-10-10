import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, List, Section } from "@/components/LegalPage";
import { getLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = { title: "Terms of Service — hibino" };

/** The terms Google's consent screen links to. Short on purpose: a
 * personal tool, provided as is, with the AI and health caveats the app
 * already states where those features live. Public — see proxy.ts. */
export default async function TermsPage() {
  const locale = await getLocale();
  return locale === "ja" ? <Ja /> : <En />;
}

function Ja() {
  return (
    <LegalPage title="利用規約" updated="最終更新日: 2026年10月11日">
      <p className="text-ink-soft">この規約は、hibino（以下「本サービス」）の利用条件を定めるものです。本サービスを利用した時点で、この規約に同意したものとします。</p>
      <Section heading="1. サービスの内容">
        <p className="text-ink-soft">本サービスは、メモ・予定・献立・家計・運動などを個人で記録・計画するためのウェブアプリです。Googleアカウントでログインして利用します。</p>
      </Section>
      <Section heading="2. アカウント">
        <p className="text-ink-soft">利用者は自身のGoogleアカウントを適切に管理するものとします。アカウントの不正利用による損害について、本サービスは責任を負いません。</p>
      </Section>
      <Section heading="3. AIによる提案について">
        <p className="text-ink-soft">
          献立・トレーニング・家計などの提案は、利用者が登録したAIサービスのAPIキーを使って生成され、料金はそのキーにかかります。提案は参考情報であり、正確性を保証しません。栄養・運動の提案は医療上の助言ではありません。持病や怪我がある場合、医師・管理栄養士などの指導がある場合は、そちらを優先してください。
        </p>
      </Section>
      <Section heading="4. 禁止事項">
        <List items={["法令や公序良俗に反する行為", "本サービスや第三者の運営を妨げる行為（過度な負荷をかける行為、不正アクセスなど）", "他人のアカウントやデータを利用する行為"]} />
      </Section>
      <Section heading="5. 免責">
        <p className="text-ink-soft">
          本サービスは現状のまま提供され、特定の目的への適合性や継続的な提供を保証しません。データの消失やサービスの停止・変更によって生じた損害について、法令で認められる範囲で責任を負いません。大切なデータは利用者自身でも控えを取ってください。
        </p>
      </Section>
      <Section heading="6. 変更・終了">
        <p className="text-ink-soft">本サービスの内容やこの規約は、予告なく変更・終了することがあります。重要な変更はこのページで告知します。</p>
      </Section>
      <Section heading="7. 個人情報">
        <p className="text-ink-soft">
          個人情報の扱いは
          <Link href="/privacy" className="text-accent underline">
            プライバシーポリシー
          </Link>
          に定めます。
        </p>
      </Section>
      <Section heading="8. 準拠法">
        <p className="text-ink-soft">この規約は日本法に準拠します。</p>
      </Section>
    </LegalPage>
  );
}

function En() {
  return (
    <LegalPage title="Terms of Service" updated="Last updated: October 11, 2026">
      <p className="text-ink-soft">These terms govern the use of hibino (“the Service”). By using the Service you agree to them.</p>
      <Section heading="1. The Service">
        <p className="text-ink-soft">A web app for personally recording and planning notes, schedules, meals, money and training. You sign in with a Google account.</p>
      </Section>
      <Section heading="2. Your account">
        <p className="text-ink-soft">You are responsible for your Google account. The Service is not liable for damage caused by unauthorized use of it.</p>
      </Section>
      <Section heading="3. AI proposals">
        <p className="text-ink-soft">
          Meal, training and money proposals are generated with the AI API key you register, and any cost is charged to that key. Proposals are for reference and their accuracy is not guaranteed. Nutrition and training suggestions are not medical advice; if you have a condition or injury, or are under the care of a doctor or dietitian, follow their guidance first.
        </p>
      </Section>
      <Section heading="4. Prohibited use">
        <List items={["Anything unlawful", "Interfering with the Service or others (excessive load, unauthorized access, etc.)", "Using another person's account or data"]} />
      </Section>
      <Section heading="5. Disclaimer">
        <p className="text-ink-soft">
          The Service is provided as is, without warranty of fitness for a particular purpose or of continued availability. To the extent permitted by law, the Service is not liable for loss of data or for interruption or change of the Service. Keep your own copies of anything important.
        </p>
      </Section>
      <Section heading="6. Changes and termination">
        <p className="text-ink-soft">The Service and these terms may change or end without notice. Significant changes are announced on this page.</p>
      </Section>
      <Section heading="7. Personal information">
        <p className="text-ink-soft">
          Personal information is handled under the{" "}
          <Link href="/privacy" className="text-accent underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Section>
      <Section heading="8. Governing law">
        <p className="text-ink-soft">These terms are governed by the laws of Japan.</p>
      </Section>
    </LegalPage>
  );
}
