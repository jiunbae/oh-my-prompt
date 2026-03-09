import type { LLMConfig } from "./types";
import { logger } from "@/lib/logger";

/**
 * Lightweight LLM client that supports multiple providers.
 * Users bring their own API key via environment variables.
 */

const VALID_PROVIDERS = new Set(["anthropic", "openai", "azure", "gemini", "ollama", "custom"]);

/** Models that use reasoning tokens and require max_completion_tokens instead of max_tokens */
const REASONING_MODEL_PATTERNS = [
  /^o[1-9]/, // OpenAI o1, o3, o4-mini, etc.
  /^gpt-5/, // GPT-5 series
];

function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_PATTERNS.some((p) => p.test(model));
}

export function getLLMConfig(): LLMConfig | null {
  const provider = process.env.OMP_LLM_PROVIDER;
  if (!provider) return null;

  if (!VALID_PROVIDERS.has(provider)) {
    logger.error({ provider, valid: [...VALID_PROVIDERS] }, "Invalid OMP_LLM_PROVIDER");
    return null;
  }

  return {
    provider: provider as LLMConfig["provider"],
    apiKey: process.env.OMP_LLM_API_KEY,
    model: process.env.OMP_LLM_MODEL || getDefaultModel(provider),
    baseUrl: process.env.OMP_LLM_BASE_URL,
    maxTokens: parseInt(process.env.OMP_LLM_MAX_TOKENS || "2048", 10),
    temperature: parseFloat(process.env.OMP_LLM_TEMPERATURE || "0.3"),
    azureDeployment: process.env.OMP_LLM_AZURE_DEPLOYMENT,
    azureApiVersion: process.env.OMP_LLM_AZURE_API_VERSION,
  };
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-5-20250929";
    case "openai":
      return "gpt-4o-mini";
    case "azure":
      return "gpt-4o-mini";
    case "gemini":
      return "gemini-2.5-flash";
    case "ollama":
      return "llama3.2";
    default:
      return "gpt-4o-mini";
  }
}

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMResponse {
  content: string;
  model: string;
  tokensUsed?: number;
}

/**
 * Call the configured LLM provider with a list of messages.
 * Returns the assistant's text response.
 */
export async function callLLM(
  messages: LLMMessage[],
  config?: LLMConfig,
): Promise<LLMResponse> {
  const cfg = config || getLLMConfig();
  if (!cfg) {
    throw new Error(
      "LLM not configured. Set OMP_LLM_PROVIDER and OMP_LLM_API_KEY environment variables.",
    );
  }

  switch (cfg.provider) {
    case "anthropic":
      return callAnthropic(messages, cfg);
    case "openai":
    case "custom":
      return callOpenAICompatible(messages, cfg);
    case "azure":
      return callAzureOpenAI(messages, cfg);
    case "gemini":
      return callGemini(messages, cfg);
    case "ollama":
      return callOpenAICompatible(messages, {
        ...cfg,
        baseUrl: cfg.baseUrl || "http://localhost:11434/v1",
      });
    default:
      throw new Error(`Unknown LLM provider: ${cfg.provider}`);
  }
}

// ── Anthropic ──────────────────────────────────────────────────────

async function callAnthropic(
  messages: LLMMessage[],
  cfg: LLMConfig,
): Promise<LLMResponse> {
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystemMsgs = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: cfg.maxTokens || 2048,
    temperature: cfg.temperature ?? 0.3,
    messages: nonSystemMsgs.map((m) => ({ role: m.role, content: m.content })),
  };
  if (systemMsg) {
    body.system = systemMsg.content;
  }

  const res = await fetch(cfg.baseUrl || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content =
    data.content
      ?.filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("") || "";

  return {
    content,
    model: data.model || cfg.model,
    tokensUsed: data.usage
      ? (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)
      : undefined,
  };
}

// ── OpenAI (and compatible: Ollama, custom) ────────────────────────

function buildOpenAIBody(messages: LLMMessage[], cfg: LLMConfig): Record<string, unknown> {
  const reasoning = isReasoningModel(cfg.model);
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  if (reasoning) {
    body.max_completion_tokens = cfg.maxTokens || 2048;
    // reasoning models don't support temperature
  } else {
    body.max_tokens = cfg.maxTokens || 2048;
    body.temperature = cfg.temperature ?? 0.3;
  }

  return body;
}

async function callOpenAICompatible(
  messages: LLMMessage[],
  cfg: LLMConfig,
): Promise<LLMResponse> {
  const baseUrl = cfg.baseUrl || "https://api.openai.com/v1";

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify(buildOpenAIBody(messages, cfg)),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI-compatible API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    model: data.model || cfg.model,
    tokensUsed: data.usage
      ? (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0)
      : undefined,
  };
}

// ── Azure OpenAI ───────────────────────────────────────────────────

async function callAzureOpenAI(
  messages: LLMMessage[],
  cfg: LLMConfig,
): Promise<LLMResponse> {
  const deployment = cfg.azureDeployment || cfg.model;
  const apiVersion = cfg.azureApiVersion || "2024-12-01-preview";
  const baseUrl = cfg.baseUrl?.replace(/\/$/, "");

  const url = `${baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const body = buildOpenAIBody(messages, cfg);
  delete body.model; // Azure uses deployment name in URL, not body

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": cfg.apiKey || "",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure OpenAI API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    model: data.model || cfg.model,
    tokensUsed: data.usage
      ? (data.usage.prompt_tokens || 0) + (data.usage.completion_tokens || 0)
      : undefined,
  };
}

// ── Google Gemini ──────────────────────────────────────────────────

async function callGemini(
  messages: LLMMessage[],
  cfg: LLMConfig,
): Promise<LLMResponse> {
  const baseUrl = cfg.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  const model = cfg.model || "gemini-2.5-flash";

  // Convert messages to Gemini format
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystemMsgs = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    contents: nonSystemMsgs.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      maxOutputTokens: cfg.maxTokens || 2048,
      temperature: cfg.temperature ?? 0.3,
    },
  };

  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const url = `${baseUrl.replace(/\/$/, "")}/models/${model}:generateContent?key=${cfg.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content =
    data.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text || "")
      .join("") || "";

  return {
    content,
    model: model,
    tokensUsed: data.usageMetadata
      ? (data.usageMetadata.promptTokenCount || 0) + (data.usageMetadata.candidatesTokenCount || 0)
      : undefined,
  };
}
