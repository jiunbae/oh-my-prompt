import { PromptDetail } from "@/components/prompt-detail";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

// Force dynamic rendering - don't pre-render at build time
export const dynamic = "force-dynamic";

async function getPrompt(id: string) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  const client = postgres(connectionString);
  const db = drizzle(client, { schema });

  const result = await db
    .select()
    .from(schema.prompts)
    .where(eq(schema.prompts.id, id))
    .limit(1);

  await client.end();

  return result[0] ?? null;
}

interface PromptDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PromptDetailPage({ params }: PromptDetailPageProps) {
  const resolvedParams = await params;
  const prompt = await getPrompt(resolvedParams.id);

  if (!prompt) {
    notFound();
  }

  // Parse the prompt to create a simple message structure
  const messages = [
    {
      role: "user" as const,
      content: prompt.promptText,
      timestamp: prompt.timestamp,
      tokens: prompt.tokenEstimate ?? Math.ceil(prompt.promptLength / 4),
    },
  ];

  return (
    <PromptDetail
      id={prompt.id}
      sessionId={prompt.minioKey}
      timestamp={prompt.timestamp}
      projectName={prompt.projectName}
      workingDirectory={prompt.workingDirectory}
      messages={messages}
      inputTokens={prompt.tokenEstimate ?? Math.ceil(prompt.promptLength / 4)}
      outputTokens={0}
      promptType={prompt.promptType}
      tags={[]}
    />
  );
}
