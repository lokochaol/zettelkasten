import type { Metadata } from "next";
import { LegalPage, List, Section } from "@/components/LegalPage";
import { getLocale } from "@/lib/i18n/locale";

export const metadata: Metadata = { title: "Privacy Policy — hibino" };

/** The privacy policy Google’s consent screen links to. Written to match
 * what the code actually does: what's stored, which Google scopes are
 * asked for and why, and where data goes (only to services the owner
 * connects themselves). Public — see the exemption in proxy.ts. */
export default async function PrivacyPage() {
  const locale = await getLocale();
  return locale === "ja" ? <Ja /> : <En />;
}

function Ja() {
  return (
    <LegalPage title="プライバシーポリシー" updated="最終更新日: 2026年10月11日">
      <p className="text-ink-soft">
        hibino（以下「本サービス」）は、メモ・予定・献立・家計・運動などを1か所で扱う個人向けのウェブアプリです。本サービスがどの情報を扱い、どう使うかを説明します。
      </p>
      <Section heading="1. 取得する情報">
        <List
          items={[
            "Googleアカウントでのログイン時: メールアドレス、氏名、プロフィール画像、Googleのアカウント識別子。",
            "Googleカレンダーを連携した場合（任意）: 予定の読み取りと、献立などの予定の書き込みに必要な範囲（https://www.googleapis.com/auth/calendar.events）。連携は設定画面から利用者自身が行い、いつでも解除できます。",
            "利用者が入力・取り込みした内容: メモ、プロジェクト、予定、献立、在庫、支出・明細、体組成やトレーニングの記録など。",
            "利用者が登録した外部サービスの認証情報: AI（Claude / ChatGPT / Gemini）のAPIキー、Zoteroのキー、iPhoneのショートカット用のトークン。これらは暗号化して保存します。",
          ]}
        />
      </Section>
      <Section heading="2. 利用目的">
        <p className="text-ink-soft">
          取得した情報は、本サービスの機能を利用者本人に提供するためだけに使います（ログイン、データの保存と表示、カレンダーへの表示・書き出し、利用者が依頼したAIによる献立・トレーニングの提案など）。広告、プロファイリング、第三者への販売には使いません。
        </p>
      </Section>
      <Section heading="3. Googleユーザーデータの取り扱い">
        <p className="text-ink-soft">
          Google APIから受け取った情報の利用と他のアプリへの転送は、
          <a className="text-accent underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API サービスのユーザーデータに関するポリシー
          </a>
          （限定使用の要件を含む）に従います。Googleカレンダーのデータは、本サービスの画面に表示することと、利用者が指示した予定を書き込むことにのみ使い、AIモデルの学習には使いません。
        </p>
      </Section>
      <Section heading="4. 第三者への提供">
        <p className="text-ink-soft">
          法令に基づく場合を除き、利用者の同意なく第三者に提供しません。ただし、利用者自身がAPIキーを登録したAIサービスには、利用者が依頼した処理（献立やトレーニングの提案など）に必要な範囲で内容が送られます。その扱いは各AIサービスの規約に従います。本サービスは、ホスティング（Vercel）とデータベースの事業者を処理の委託先として利用します。
        </p>
      </Section>
      <Section heading="5. 保存と削除">
        <p className="text-ink-soft">
          データは利用者がアカウントを使っている間保存します。Googleカレンダーの連携や各種キーは設定画面から削除できます。アカウントとデータ全体の削除を希望する場合は、下記の連絡先までご連絡ください。Googleアカウント側からも、
          <a className="text-accent underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            サードパーティのアクセス
          </a>
          で本サービスへのアクセスを取り消せます。
        </p>
      </Section>
      <Section heading="6. 安全管理">
        <p className="text-ink-soft">通信はHTTPSで暗号化し、認証情報は暗号化して保存します。各利用者のデータは、その利用者だけが閲覧・操作できます。</p>
      </Section>
      <Section heading="7. 改定とお問い合わせ">
        <p className="text-ink-soft">
          本ポリシーを改定する場合は、このページで告知します。お問い合わせは、Googleのログイン画面（同意画面）に表示されるデベロッパーの連絡先メールアドレスまでお願いします。
        </p>
      </Section>
    </LegalPage>
  );
}

function En() {
  return (
    <LegalPage title="Privacy Policy" updated="Last updated: October 11, 2026">
      <p className="text-ink-soft">
        hibino (“the Service”) is a personal web app for notes, schedules, meals, money and training in one place. This page explains what information the Service handles and how it is used.
      </p>
      <Section heading="1. Information collected">
        <List
          items={[
            "When you sign in with Google: your email address, name, profile picture and Google account identifier.",
            "If you link Google Calendar (optional): access to read your events and write events such as meals (https://www.googleapis.com/auth/calendar.events). You link it yourself in Settings and can unlink it at any time.",
            "Content you enter or import: notes, projects, schedules, meals, inventory, expenses and statements, body composition and training logs.",
            "Credentials you register for other services: AI (Claude / ChatGPT / Gemini) API keys, a Zotero key, and the token for the iPhone Shortcut. These are stored encrypted.",
          ]}
        />
      </Section>
      <Section heading="2. How it is used">
        <p className="text-ink-soft">
          Only to provide the Service’s features to you: signing in, storing and showing your data, showing and writing calendar events, and the meal and training proposals you ask the AI for. It is not used for advertising, profiling, or sold to anyone.
        </p>
      </Section>
      <Section heading="3. Google user data">
        <p className="text-ink-soft">
          The Service’s use and transfer of information received from Google APIs adheres to the{" "}
          <a className="text-accent underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google Calendar data is used only to show it in the Service and to write events you ask for, and is not used to train AI models.
        </p>
      </Section>
      <Section heading="4. Sharing">
        <p className="text-ink-soft">
          Your data is not shared with third parties without your consent, except as required by law. Content needed for a request you make (such as a meal or training proposal) is sent to the AI service whose API key you registered, under that service’s terms. The Service uses hosting (Vercel) and database providers as processors.
        </p>
      </Section>
      <Section heading="5. Retention and deletion">
        <p className="text-ink-soft">
          Data is kept while you use your account. Calendar access and stored keys can be removed in Settings. To delete your account and all data, contact us below. You can also revoke access from your Google account under{" "}
          <a className="text-accent underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            Third-party access
          </a>
          .
        </p>
      </Section>
      <Section heading="6. Security">
        <p className="text-ink-soft">Traffic is encrypted with HTTPS and credentials are stored encrypted. Each user’s data can only be seen and changed by that user.</p>
      </Section>
      <Section heading="7. Changes and contact">
        <p className="text-ink-soft">Changes to this policy are announced on this page. For questions, use the developer contact email shown on Google’s sign-in (consent) screen.</p>
      </Section>
    </LegalPage>
  );
}
