import { logger } from "@/lib/logger";

const EMBEDDING_API_URL = process.env.EMBEDDING_API_URL;
const EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "all-minilm";
const EMBEDDING_DIMENSIONS = 384;

interface EmbeddingProvider {
  generate(text: string): Promise<number[]>;
}

/**
 * Ollama-compatible embedding provider.
 * Expects endpoint like http://localhost:11434
 */
class OllamaEmbeddingProvider implements EmbeddingProvider {
  private url: string;
  private model: string;

  constructor(url: string, model: string) {
    this.url = url.replace(/\/$/, "");
    this.model = model;
  }

  async generate(text: string): Promise<number[]> {
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
    return data.embedding;
  }
}

/**
 * OpenAI-compatible embedding provider.
 * Works with OpenAI, Azure OpenAI, and any compatible API.
 */
class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  private url: string;
  private apiKey: string;
  private model: string;

  constructor(url: string, apiKey: string, model: string) {
    this.url = url.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(text: string): Promise<number[]> {
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
    return embedding;
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

  try {
    const embedding = await provider.generate(truncated);
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      logger.warn(
        { expected: EMBEDDING_DIMENSIONS, actual: embedding.length },
        "Embedding dimension mismatch"
      );
    }
    return embedding;
  } catch (error) {
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
