import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sql, eq, and, isNull } from "drizzle-orm";
import { extractRows } from "@/lib/drizzle-utils";
import { logger } from "@/lib/logger";
import { env } from "@/env";

const SUGGESTION_PROVIDER_URL = env.SUGGESTION_PROVIDER || env.EMBEDDING_API_URL || "";
const SUGGESTION_API_KEY = env.EMBEDDING_API_KEY || "";
const SUGGESTION_MODEL = env.SUGGESTION_MODEL || env.EMBEDDING_MODEL || "llama3.2";
const SUGGESTION_MAX_TOKENS = env.SUGGESTION_MAX_TOKENS;

export interface SimilarPrompt {
  id: string;
  promptText: string;
  projectName: string | null;
  similarity: number;
  createdAt: string;
}

export interface SuggestionProvider {
  url: string;
  apiKey: string | null;
  model: string;
  isOpenAI: boolean;
}

export function getSuggestionProvider(): SuggestionProvider | null {
  if (!SUGGESTION_PROVIDER_URL) {
    return null;
  }
  return {
    url: SUGGESTION_PROVIDER_URL.replace(/\/$/, ""),
    apiKey: SUGGESTION_API_KEY || null,
    model: SUGGESTION_MODEL,
    isOpenAI: !!SUGGESTION_API_KEY,
  };
}

function serializeEmbedding(embedding: number[] | string | unknown): string {
  if (Array.isArray(embedding)) {
    return `[${embedding.join(",")}]`;
  }
  if (typeof embedding === "string") {
    return embedding.startsWith("[") ? embedding : `[${embedding}]`;
  }
  return "[]";
}

export async function findSimilarPrompts(
  promptId: string,
  limit: number,
  userId: string,
  isAdmin: boolean
): Promise<SimilarPrompt[]> {
  const [targetPrompt] = await db
    .select({
      embedding: schema.prompts.embedding,
      userId: schema.prompts.userId,
    })
    .from(schema.prompts)
    .where(and(eq(schema.prompts.id, promptId), isNull(schema.prompts.deletedAt)))
    .limit(1);

  if (!targetPrompt) {
    throw new Error("Prompt not found");
  }

  if (!isAdmin && targetPrompt.userId !== userId) {
    throw new Error("Access denied");
  }

  if (!targetPrompt.embedding) {
    throw new Error("Embedding not generated yet");
  }

  const vectorLiteral = serializeEmbedding(targetPrompt.embedding);

  const rowsResult = await db.execute(sql`
    SELECT
      id,
      timestamp,
      project_name,
      LEFT(prompt_text, 300) as prompt_text,
      1 - (embedding <-> ${vectorLiteral}::vector) as similarity
    FROM prompts
    WHERE user_id = ${targetPrompt.userId}
      AND deleted_at IS NULL
      AND embedding IS NOT NULL
      AND id != ${promptId}
    ORDER BY embedding <-> ${vectorLiteral}::vector
    LIMIT ${limit}
  `);

  const rows = extractRows(rowsResult) as unknown as Record<string, unknown>[];

  return rows.map((row) => ({
    id: row.id as string,
    promptText: row.prompt_text as string,
    projectName: row.project_name as string | null,
    similarity: Number(row.similarity),
    createdAt: String(row.timestamp),
  }));
}

export interface RewriteSuggestion {
  original: string;
  suggestion: string;
  goal: string;
}

export async function suggestRewrite(
  promptText: string,
  goal: string
): Promise<RewriteSuggestion | null> {
  const provider = getSuggestionProvider();
  if (!provider) {
    return null;
  }

  const instruction = `Rewrite the following prompt to improve ${goal}. Original: ${promptText}`;

  try {
    let suggestion: string;

    if (provider.isOpenAI) {
      const response = await fetch(`${provider.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: "user", content: instruction }],
          max_tokens: SUGGESTION_MAX_TOKENS,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "unknown");
        throw new Error(`LLM API error (${response.status}): ${body}`);
      }

      const data = await response.json();
      suggestion = data.choices?.[0]?.message?.content ?? "";
    } else {
      const response = await fetch(`${provider.url}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: provider.model,
          prompt: instruction,
          stream: false,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "unknown");
        throw new Error(`Ollama API error (${response.status}): ${body}`);
      }

      const data = await response.json();
      suggestion = data.response ?? "";
    }

    return {
      original: promptText,
      suggestion: suggestion.trim(),
      goal,
    };
  } catch (error) {
    logger.error({ err: error }, "Failed to generate rewrite suggestion");
    return null;
  }
}
