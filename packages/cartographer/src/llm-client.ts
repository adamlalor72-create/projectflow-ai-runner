import type {
  LLMClient,
  LLMMessage,
  LLMResponse,
} from "../contracts/types/llm-client.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6-20250514";
const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicLLMClient implements LLMClient {
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, options?: { defaultModel?: string }) {
    this.apiKey = apiKey;
    this.defaultModel = options?.defaultModel ?? DEFAULT_MODEL;
  }

  async complete(
    messages: LLMMessage[],
    options?: { model?: string; maxTokens?: number },
  ): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;
    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;

    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join("\n\n");
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg =
        (err as Record<string, Record<string, string>>).error?.message ??
        `HTTP ${res.status}`;
      throw new Error(`Anthropic API error: ${msg}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
      model: string;
    };

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    return {
      content: text,
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
      model: data.model,
    };
  }
}
