import { PromptDetail } from "@/components/prompt-detail";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { checkIsAdmin, getSessionUser } from "@/lib/with-auth";
import { SimilarPrompts } from "@/components/similar-prompts";

// Force dynamic rendering - don't pre-render at build time
export const dynamic = "force-dynamic";

const getCurrentUser = getSessionUser;

async function getPromptWithTags(id: string, userId: string, isAdmin: boolean) {
  // Admins can view any prompt; non-admins are scoped to their own prompts.
  const whereCondition = isAdmin
    ? and(eq(schema.prompts.id, id), isNull(schema.prompts.deletedAt))
    : and(eq(schema.prompts.id, id), eq(schema.prompts.userId, userId), isNull(schema.prompts.deletedAt));

  return db.query.prompts.findFirst({
    where: whereCondition,
    with: {
      promptTags: {
        with: {
          tag: true,
        },
      },
    },
  }) ?? null;
}

interface PromptDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PromptDetailPage({ params }: PromptDetailPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolvedParams = await params;
  const isAdmin = await checkIsAdmin(user.userId);

  const prompt = await getPromptWithTags(resolvedParams.id, user.userId, isAdmin);

  if (!prompt) {
    notFound();
  }

  const tags = prompt.promptTags.map(pt => pt.tag);

  // Parse the prompt to create a simple message structure
  const messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
    tokens: number;
  }> = [
    {
      role: "user",
      content: prompt.promptText,
      timestamp: prompt.timestamp,
      tokens: prompt.tokenEstimate ?? Math.ceil(prompt.promptLength / 4),
    },
  ];

  if (prompt.responseText) {
    messages.push({
      role: "assistant",
      content: prompt.responseText,
      timestamp: prompt.updatedAt ?? prompt.timestamp,
      tokens: prompt.tokenEstimateResponse ?? Math.ceil((prompt.responseLength ?? 0) / 4),
    });
  }

  return (
    <div className="space-y-8">
      <PromptDetail
        id={prompt.id}
        sessionId={prompt.sessionId ?? undefined}
        timestamp={prompt.timestamp}
        projectName={prompt.projectName}
        workingDirectory={prompt.workingDirectory}
        messages={messages}
        inputTokens={prompt.tokenEstimate ?? Math.ceil(prompt.promptLength / 4)}
        outputTokens={prompt.tokenEstimateResponse ?? 0}
        promptType={prompt.promptType}
        tags={tags}
      />

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Similar Prompts</h2>
          <p className="text-sm text-muted-foreground">
            Find related prompts using semantic search.
          </p>
        </div>
        <SimilarPrompts promptId={prompt.id} />
      </section>
    </div>
  );
}
