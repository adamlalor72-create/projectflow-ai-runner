export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
}

export interface LLMClient {
  complete(messages: LLMMessage[], options?: { model?: string; maxTokens?: number }): Promise<LLMResponse>;
}
