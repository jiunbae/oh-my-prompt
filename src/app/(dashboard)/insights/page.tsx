import { getTranslations } from "next-intl/server";
import { AskData } from "@/components/insights/ask-data";
import { RecentInsights } from "@/components/insights/recent-insights";
import { SessionStories } from "@/components/insights/session-stories";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const t = await getTranslations("insights");
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      {/* Section 1: Ask Your Data */}
      <AskData />

      {/* Section 2: Recent Insights */}
      <RecentInsights />

      {/* Section 3: Session Stories */}
      <SessionStories />
    </div>
  );
}
