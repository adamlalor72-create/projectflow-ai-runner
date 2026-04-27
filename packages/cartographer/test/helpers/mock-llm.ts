import type { LLMClient, LLMResponse, LLMMessage } from "../../contracts/types/llm-client.js";

export function createMockLLM(
  responses?: string[]
): LLMClient & { callCount: number; messages: LLMMessage[][] } {
  let idx = 0;
  const messages: LLMMessage[][] = [];

  return {
    callCount: 0,
    messages,
    async complete(msgs: LLMMessage[]): Promise<LLMResponse> {
      messages.push(msgs);
      const content = responses?.[idx] ?? `Mock response ${idx}`;
      idx++;
      (this as any).callCount++;
      return {
        content,
        input_tokens: 500,
        output_tokens: 200,
        model: "claude-sonnet-4-6",
      };
    },
  };
}
