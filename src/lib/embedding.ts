import { logger } from "@/lib/logger";
import {
  emptyTokens,
  resolveUsageProviderFromUrl,
  toTokenCount,
  type UsageTokens,
} from "@/lib/usage/contract";
import { recordUsage } from "@/lib/usage/report";

const EMBEDDING_API_URL = process.env.EMBEDDING_API_URL;
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "all-minilm";
const EMBEDDING_DIMENSIONS = 384;

/**
 * An embedding call is a billable provider request, so it reports usage like
 * any other. The result carries whatever usage metadata the endpoint returned;
 * Ollama returns none, which the contract covers with zeros.
 */
interface EmbeddingResult {
  embedding: number[];
  tokens: UsageTokens;
}

interface EmbeddingProvider {
  /** Model ID to report, and the endpoint that determines the vendor. */
  readonly model: string;
  readonly url: string;
  generate(text: string): Promise<EmbeddingResult>;
}

/**
 * Ollama-compatible embedding provider.
 * Expects endpoint like http://localhost:11434
 */
class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly url: string;
  readonly model: string;

  constructor(url: string, model: string) {
    this.url = url.replace(/\/$/, "");
    this.model = model;
  }

  async generate(text: string): Promise<EmbeddingResult> {
    const response = await fetch(`${this.url}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "unknown");
      throw new Error(`Ollama embedding error (${response.status}): ${body}`);
    }

    const data = await response.json();
    if (!Array.isArray(data.embedding)) {
      throw new Error("Invalid Ollama embedding response: missing embedding array");
    }
    // /api/embeddings reports no token counts. Zeros are the contract's
    // documented answer for "the provider did not tell us".
    return { embedding: data.embedding, tokens: emptyTokens() };
  }
}

/**
 * OpenAI-compatible embedding provider.
 * Works with OpenAI, Azure OpenAI, and any compatible API.
 */
class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly url: string;
  readonly model: string;
  private apiKey: string;

  constructor(url: string, apiKey: string, model: string) {
    this.url = url.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(text: string): Promise<EmbeddingResult> {
    const response = await fetch(`${this.url}/v1/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "unknown");
      throw new Error(`Embedding API error (${response.status}): ${body}`);
    }

    const data = await response.json();
    const embedding = data.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error("Invalid embedding API response: missing embedding array");
    }
    // Embedding responses have no completion tokens; everything billed is input.
    const inputTokens = toTokenCount(data.usage?.prompt_tokens);
    return {
      embedding,
      tokens: {
        inputTokens,
        outputTokens: 0,
        cachedInputTokens: 0,
        totalTokens:
          data.usage?.total_tokens != null
            ? toTokenCount(data.usage.total_tokens)
            : inputTokens,
      },
    };
  }
}

function getProvider(): EmbeddingProvider | null {
  if (!EMBEDDING_API_URL) {
    return null;
  }

  // Detect provider type from URL shape or key presence
  if (EMBEDDING_API_KEY) {
    return new OpenAICompatibleEmbeddingProvider(
      EMBEDDING_API_URL,
      EMBEDDING_API_KEY,
      EMBEDDING_MODEL
    );
  }

  return new OllamaEmbeddingProvider(EMBEDDING_API_URL, EMBEDDING_MODEL);
}

/**
 * Generate a 384-dimension embedding vector for the given text.
 * Returns null if no embedding provider is configured.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const provider = getProvider();
  if (!provider) {
    return null;
  }

  // Truncate very long inputs (most embedding models have ~512-8192 token limits)
  const truncated = text.slice(0, 8000);

  const usageProvider = resolveUsageProviderFromUrl(provider.url);
  const occurredAt = new Date();
  const startedAt = Date.now();

  try {
    const { embedding, tokens } = await provider.generate(truncated);

    await recordUsage({
      provider: usageProvider,
      model: provider.model,
      tokens,
      status: "success",
      latencyMs: Date.now() - startedAt,
      occurredAt,
    });

    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      logger.warn(
        { expected: EMBEDDING_DIMENSIONS, actual: embedding.length },
        "Embedding dimension mismatch"
      );
    }
    return embedding;
  } catch (error) {
    await recordUsage({
      provider: usageProvider,
      model: provider.model,
      tokens: emptyTokens(),
      status: "error",
      latencyMs: Date.now() - startedAt,
      occurredAt,
    });
    logger.error({ err: error }, "Failed to generate embedding");
    return null;
  }
}

/**
 * Convert a number array to a PostgreSQL vector literal string.
 * e.g. [0.1, 0.2, ...] -> "[0.1,0.2,...]"
 */
export function embeddingToSqlVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
