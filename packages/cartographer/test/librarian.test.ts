import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Librarian } from "../services/librarian/index.js";
import { MapStore } from "../services/store/index.js";
import { makeMinimalMap, makeTestRecord } from "./helpers/fixtures.js";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_KNOWLEDGE_ROOT = path.join(__dirname, ".test-librarian-knowledge");

let store: MapStore;
let librarian: Librarian;

beforeEach(() => {
  store = new MapStore();

  mkdirSync(path.join(TEST_KNOWLEDGE_ROOT, "activities", "102934_test"), { recursive: true });
  mkdirSync(path.join(TEST_KNOWLEDGE_ROOT, "general"), { recursive: true });
  writeFileSync(
    path.join(TEST_KNOWLEDGE_ROOT, "activities", "102934_test", "overview.md"),
    "# Overview\n"
  );
  writeFileSync(
    path.join(TEST_KNOWLEDGE_ROOT, "general", "standard_conventions.md"),
    "# Standard Conventions\n"
  );

  librarian = new Librarian({ store, knowledgeRoot: TEST_KNOWLEDGE_ROOT });
});

afterEach(() => {
  librarian.close();
  store.close();
  if (existsSync(TEST_KNOWLEDGE_ROOT)) {
    rmSync(TEST_KNOWLEDGE_ROOT, { recursive: true });
  }
});

describe("Librarian", () => {
  describe("source scores", () => {
    it("increases score on verify pass", async () => {
      const score = await librarian.updateSourceScore("https://help.sap.com/doc1", true);
      expect(score.accuracy).toBeCloseTo(1.1);
      expect(score.citations).toBe(1);
      expect(score.demoted).toBe(false);
    });

    it("decreases score on verify fail", async () => {
      const score = await librarian.updateSourceScore("https://help.sap.com/doc1", false);
      expect(score.accuracy).toBeCloseTo(0.8);
    });

    it("demotes source below 0.5 threshold", async () => {
      await librarian.updateSourceScore("https://bad-source.sap.com/x", false);
      await librarian.updateSourceScore("https://bad-source.sap.com/x", false);
      const score = await librarian.updateSourceScore("https://bad-source.sap.com/x", false);
      expect(score.accuracy).toBeLessThan(0.5);
      expect(score.demoted).toBe(true);
    });

    it("lists all scores", async () => {
      await librarian.updateSourceScore("https://a.sap.com", true);
      await librarian.updateSourceScore("https://b.sap.com", false);

      const scores = await librarian.getSourceScores();
      expect(scores).toHaveLength(2);
    });

    it("lists only demoted sources", async () => {
      await librarian.updateSourceScore("https://good.sap.com", true);
      for (let i = 0; i < 4; i++) {
        await librarian.updateSourceScore("https://bad.sap.com", false);
      }

      const demoted = await librarian.getDemotedSources();
      expect(demoted).toHaveLength(1);
      expect(demoted[0].url).toBe("https://bad.sap.com");
    });
  });

  describe("promotePattern", () => {
    it("appends pattern to general knowledge file", async () => {
      await librarian.promotePattern({
        category: "standard_conventions",
        pattern: "Use F4 help for value fields",
        description: "Always trigger F4 help dialog for fields with value help.",
        source_activity_id: "102934",
      });

      const content = readFileSync(
        path.join(TEST_KNOWLEDGE_ROOT, "general", "standard_conventions.md"),
        "utf8"
      );
      expect(content).toContain("Use F4 help for value fields");
      expect(content).toContain("Activity 102934");
    });
  });

  describe("rebuildIndex", () => {
    it("creates INDEX.md with activities and general files", async () => {
      const result = await librarian.rebuildIndex();

      expect(result.files_indexed).toBeGreaterThanOrEqual(2);
      expect(result.activities_indexed).toBe(1);

      const indexPath = path.join(TEST_KNOWLEDGE_ROOT, "INDEX.md");
      expect(existsSync(indexPath)).toBe(true);
      const content = readFileSync(indexPath, "utf8");
      expect(content).toContain("102934_test");
      expect(content).toContain("standard_conventions.md");
    });
  });

  describe("assessConfidence", () => {
    it("returns low for nonexistent activity", async () => {
      const confidence = await librarian.assessConfidence("nonexistent");
      expect(confidence).toBe("low");
    });

    it("returns low for activity with no test records", async () => {
      await store.saveMap(makeMinimalMap());
      const confidence = await librarian.assessConfidence("102934");
      expect(confidence).toBe("low");
    });

    it("returns medium for activity with passing records", async () => {
      await store.saveMap(makeMinimalMap());
      await store.appendTestRecord("102934", makeTestRecord({ passed: true }));

      const confidence = await librarian.assessConfidence("102934");
      expect(confidence).toBe("medium");
    });

    it("returns high for activity with 3+ passing records", async () => {
      await store.saveMap(makeMinimalMap());
      await store.appendTestRecord("102934", makeTestRecord({ run_id: "r1", passed: true }));
      await store.appendTestRecord("102934", makeTestRecord({ run_id: "r2", passed: true }));
      await store.appendTestRecord("102934", makeTestRecord({ run_id: "r3", passed: true }));

      const confidence = await librarian.assessConfidence("102934");
      expect(confidence).toBe("high");
    });

    it("returns low for activity with drift signals", async () => {
      await store.saveMap(makeMinimalMap());
      await store.appendTestRecord("102934", makeTestRecord({ passed: true }));
      await store.appendDriftSignal("102934", {
        detected_at: new Date().toISOString(),
        field_id: "f1",
        signal_type: "selector_miss",
      });

      const confidence = await librarian.assessConfidence("102934");
      expect(confidence).toBe("low");
    });
  });
});
