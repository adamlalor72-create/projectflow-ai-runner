import type {
  ResearcherAPI,
  ResearcherInput,
  ResearcherOutput,
} from "../../contracts/researcher-api.js";
import { ResearcherError } from "../../contracts/researcher-api.js";
import type { Confidence } from "../../contracts/types/knowledge.js";
import type { LLMClient } from "../../contracts/types/llm-client.js";
import { isAllowedSource, SOURCE_ALLOWLIST } from "./source-allowlist.js";
import {
  serializeKnowledgeFile,
  buildOverview,
  buildGotchas,
  buildTestDataRecipes,
} from "./knowledge-writer.js";
import { logCost } from "../telemetry/cost-logger.js";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_ROOT = path.resolve(__dirname, "../../knowledge/activities");

export interface ResearcherOptions {
  llm: LLMClient;
  knowledgeRoot?: string;
  fetchFn?: (url: string) => Promise<string>;
}

export class Researcher implements ResearcherAPI {
  private llm: LLMClient;
  private knowledgeRoot: string;
  private fetchFn: (url: string) => Promise<string>;

  constructor(options: ResearcherOptions) {
    this.llm = options.llm;
    this.knowledgeRoot = options.knowledgeRoot ?? KNOWLEDGE_ROOT;
    this.fetchFn = options.fetchFn ?? defaultFetch;
  }

  async research(input: ResearcherInput): Promise<ResearcherOutput> {
    const start = Date.now();
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    if ((SOURCE_ALLOWLIST as readonly string[]).length === 0) {
      throw new ResearcherError("allowlist_empty", "Source allowlist is empty");
    }

    const activityName = input.activity_name ?? `Activity ${input.activity_id}`;
    const searchTerms = [activityName, input.activity_id];
    if (input.scope_item_refs) {
      searchTerms.push(...input.scope_item_refs);
    }

    const sources: Array<{ url: string; content: string; confidence: Confidence }> = [];

    for (const domain of SOURCE_ALLOWLIST) {
      for (const term of searchTerms.slice(0, 2)) {
        const url = `https://${domain}/search?q=${encodeURIComponent(term)}`;
        try {
          const content = await this.fetchFn(url);
          if (content && content.length > 100) {
            sources.push({ url, content, confidence: "medium" });
          }
        } catch {
          // skip unreachable sources
        }
      }
    }

    if (sources.length < 2) {
      throw new ResearcherError(
        "insufficient_sources",
        `Only ${sources.length} source(s) found for activity ${input.activity_id}`,
        {
          sources_cited: sources.map((s) => ({
            url: s.url,
            accessed_at: new Date().toISOString(),
            confidence: s.confidence,
          })),
        }
      );
    }

    const sourcesSummary = sources
      .map((s) => `Source: ${s.url}\n${s.content.slice(0, 2000)}`)
      .join("\n\n---\n\n");

    const overviewResponse = await this.llm.complete([
      {
        role: "system",
        content: `You are an SAP CBC expert. Write an overview for the customizing activity "${activityName}" (ID: ${input.activity_id}). Include: what it does, when to use it, prerequisites, and key fields. Use only the provided sources. If sources conflict, add an HTML comment: <!-- RESEARCHER UNCERTAIN: description -->`,
      },
      { role: "user", content: sourcesSummary },
    ]);
    totalCost += estimateCost(overviewResponse.input_tokens, overviewResponse.output_tokens);
    totalInputTokens += overviewResponse.input_tokens;
    totalOutputTokens += overviewResponse.output_tokens;

    const gotchasResponse = await this.llm.complete([
      {
        role: "system",
        content: `You are an SAP CBC expert. Write a gotchas document for "${activityName}" (ID: ${input.activity_id}). Cover: common mistakes, edge cases, order-of-operations issues, field dependencies. If uncertain, add: <!-- RESEARCHER UNCERTAIN: description -->`,
      },
      { role: "user", content: sourcesSummary },
    ]);
    totalCost += estimateCost(gotchasResponse.input_tokens, gotchasResponse.output_tokens);
    totalInputTokens += gotchasResponse.input_tokens;
    totalOutputTokens += gotchasResponse.output_tokens;

    const recipesResponse = await this.llm.complete([
      {
        role: "system",
        content: `You are an SAP CBC expert. Write test data recipes for "${activityName}" (ID: ${input.activity_id}). Include: sample data sets that exercise all fields, edge cases for validation, and expected outcomes.`,
      },
      { role: "user", content: sourcesSummary },
    ]);
    totalCost += estimateCost(recipesResponse.input_tokens, recipesResponse.output_tokens);
    totalInputTokens += recipesResponse.input_tokens;
    totalOutputTokens += recipesResponse.output_tokens;

    const overallConfidence = assessConfidence(sources);
    const sourceUrls = sources.map((s) => s.url);

    const activityDir = path.join(this.knowledgeRoot, `${input.activity_id}_${activityName.toLowerCase().replace(/\s+/g, "_")}`);
    mkdirSync(activityDir, { recursive: true });

    const filesWritten: string[] = [];
    const uncertaintyFlags: ResearcherOutput["uncertainty_flags"] = [];

    const overviewFile = path.join(activityDir, "overview.md");
    const overviewContent = buildOverview(
      input.activity_id,
      activityName,
      overviewResponse.content,
      sourceUrls,
      overallConfidence
    );
    writeFileSync(overviewFile, serializeKnowledgeFile(overviewContent));
    filesWritten.push(overviewFile);
    extractUncertaintyFlags(overviewResponse.content, "overview.md", uncertaintyFlags);

    const gotchasFile = path.join(activityDir, "gotchas.md");
    const gotchasContent = buildGotchas(
      input.activity_id,
      activityName,
      gotchasResponse.content,
      sourceUrls,
      overallConfidence
    );
    writeFileSync(gotchasFile, serializeKnowledgeFile(gotchasContent));
    filesWritten.push(gotchasFile);
    extractUncertaintyFlags(gotchasResponse.content, "gotchas.md", uncertaintyFlags);

    const recipesFile = path.join(activityDir, "test_data_recipes.md");
    const recipesContent = buildTestDataRecipes(
      input.activity_id,
      activityName,
      recipesResponse.content,
      sourceUrls,
      overallConfidence
    );
    writeFileSync(recipesFile, serializeKnowledgeFile(recipesContent));
    filesWritten.push(recipesFile);
    extractUncertaintyFlags(recipesResponse.content, "test_data_recipes.md", uncertaintyFlags);

    logCost({
      agent_name: "researcher",
      activity_id: input.activity_id,
      phase: "research",
      model: overviewResponse.model,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      cost_usd: totalCost,
    });

    return {
      files_written: filesWritten,
      sources_cited: sources.map((s) => ({
        url: s.url,
        accessed_at: new Date().toISOString(),
        confidence: s.confidence,
      })),
      uncertainty_flags: uncertaintyFlags,
      overall_confidence: overallConfidence,
      cost_usd: totalCost,
      duration_ms: Date.now() - start,
    };
  }
}

function assessConfidence(
  sources: Array<{ confidence: Confidence }>
): Confidence {
  if (sources.length >= 4) return "high";
  if (sources.length >= 2) return "medium";
  return "low";
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  // Sonnet pricing: $3/M input, $15/M output
  return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
}

function extractUncertaintyFlags(
  content: string,
  file: string,
  flags: ResearcherOutput["uncertainty_flags"]
): void {
  const regex = /<!-- RESEARCHER UNCERTAIN: (.*?) -->/g;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = regex.exec(lines[i]);
    if (match) {
      flags.push({ file, line: i + 1, note: match[1] });
    }
    regex.lastIndex = 0;
  }
}

async function defaultFetch(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
