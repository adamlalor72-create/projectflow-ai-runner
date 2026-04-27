import { describe, it, expect, afterEach } from "vitest";
import { Researcher } from "../services/researcher/index.js";
import { isAllowedSource } from "../services/researcher/source-allowlist.js";
import { ResearcherError } from "../contracts/researcher-api.js";
import { createMockLLM } from "./helpers/mock-llm.js";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_KNOWLEDGE_ROOT = path.join(__dirname, ".test-knowledge");

afterEach(() => {
  if (existsSync(TEST_KNOWLEDGE_ROOT)) {
    rmSync(TEST_KNOWLEDGE_ROOT, { recursive: true });
  }
});

function mockFetchWithSources(count: number) {
  let callIdx = 0;
  return async (_url: string) => {
    callIdx++;
    if (callIdx <= count) {
      return "A".repeat(200);
    }
    throw new Error("no content");
  };
}

describe("Researcher", () => {
  describe("source allowlist", () => {
    it("accepts help.sap.com", () => {
      expect(isAllowedSource("https://help.sap.com/docs/test")).toBe(true);
    });

    it("accepts community.sap.com", () => {
      expect(isAllowedSource("https://community.sap.com/thread/123")).toBe(true);
    });

    it("rejects non-allowed domains", () => {
      expect(isAllowedSource("https://stackoverflow.com/q/123")).toBe(false);
    });

    it("rejects invalid URLs", () => {
      expect(isAllowedSource("not a url")).toBe(false);
    });
  });

  describe("research", () => {
    it("produces three knowledge files", async () => {
      const llm = createMockLLM([
        "# Overview content",
        "# Gotchas content",
        "# Test data recipes",
      ]);

      const researcher = new Researcher({
        llm,
        knowledgeRoot: TEST_KNOWLEDGE_ROOT,
        fetchFn: mockFetchWithSources(4),
      });

      const result = await researcher.research({
        activity_id: "102934",
        activity_name: "Terms of Payment",
      });

      expect(result.files_written).toHaveLength(3);
      expect(result.files_written[0]).toContain("overview.md");
      expect(result.files_written[1]).toContain("gotchas.md");
      expect(result.files_written[2]).toContain("test_data_recipes.md");
      expect(result.cost_usd).toBeGreaterThan(0);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("makes 3 LLM calls", async () => {
      const llm = createMockLLM();

      const researcher = new Researcher({
        llm,
        knowledgeRoot: TEST_KNOWLEDGE_ROOT,
        fetchFn: mockFetchWithSources(4),
      });

      await researcher.research({
        activity_id: "102934",
        activity_name: "Terms of Payment",
      });

      expect(llm.callCount).toBe(3);
    });

    it("throws insufficient_sources when too few sources", async () => {
      const llm = createMockLLM();

      const researcher = new Researcher({
        llm,
        knowledgeRoot: TEST_KNOWLEDGE_ROOT,
        fetchFn: mockFetchWithSources(0),
      });

      await expect(
        researcher.research({
          activity_id: "99999",
          activity_name: "Unknown Activity",
        })
      ).rejects.toThrow(ResearcherError);

      try {
        await researcher.research({
          activity_id: "99999",
          activity_name: "Unknown Activity",
        });
      } catch (err) {
        expect((err as ResearcherError).code).toBe("insufficient_sources");
      }
    });

    it("extracts uncertainty flags from LLM output", async () => {
      const llm = createMockLLM([
        "Content here\n<!-- RESEARCHER UNCERTAIN: field order unclear -->\nMore content",
        "Clean content",
        "Also clean",
      ]);

      const researcher = new Researcher({
        llm,
        knowledgeRoot: TEST_KNOWLEDGE_ROOT,
        fetchFn: mockFetchWithSources(4),
      });

      const result = await researcher.research({
        activity_id: "102934",
        activity_name: "Terms of Payment",
      });

      expect(result.uncertainty_flags).toHaveLength(1);
      expect(result.uncertainty_flags[0].note).toBe("field order unclear");
      expect(result.uncertainty_flags[0].file).toBe("overview.md");
    });

    it("assesses confidence based on source count", async () => {
      const llm = createMockLLM();

      const researcher = new Researcher({
        llm,
        knowledgeRoot: TEST_KNOWLEDGE_ROOT,
        fetchFn: mockFetchWithSources(2),
      });

      const result = await researcher.research({
        activity_id: "102934",
        activity_name: "Terms of Payment",
      });

      expect(result.overall_confidence).toBe("medium");
    });

    it("writes files to the correct directory", async () => {
      const llm = createMockLLM(["overview", "gotchas", "recipes"]);

      const researcher = new Researcher({
        llm,
        knowledgeRoot: TEST_KNOWLEDGE_ROOT,
        fetchFn: mockFetchWithSources(4),
      });

      await researcher.research({
        activity_id: "102934",
        activity_name: "Terms of Payment",
      });

      const activityDir = path.join(TEST_KNOWLEDGE_ROOT, "102934_terms_of_payment");
      expect(existsSync(path.join(activityDir, "overview.md"))).toBe(true);
      expect(existsSync(path.join(activityDir, "gotchas.md"))).toBe(true);
      expect(existsSync(path.join(activityDir, "test_data_recipes.md"))).toBe(true);
    });
  });
});
