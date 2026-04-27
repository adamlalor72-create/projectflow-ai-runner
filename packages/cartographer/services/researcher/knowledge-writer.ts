import type { Confidence, KnowledgeFrontmatter } from "../../contracts/types/knowledge.js";

export interface KnowledgeFileContent {
  frontmatter: KnowledgeFrontmatter;
  body: string;
}

export function serializeKnowledgeFile(file: KnowledgeFileContent): string {
  const yaml = Object.entries(file.frontmatter)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length === 0) return `${k}: []`;
        return `${k}:\n${v.map((item) => `  - ${JSON.stringify(item)}`).join("\n")}`;
      }
      if (v === null) return `${k}: null`;
      if (typeof v === "string") return `${k}: "${v}"`;
      return `${k}: ${v}`;
    })
    .join("\n");

  return `---\n${yaml}\n---\n\n${file.body}\n`;
}

export function buildOverview(
  activityId: string,
  activityName: string,
  content: string,
  sources: string[],
  confidence: Confidence
): KnowledgeFileContent {
  return {
    frontmatter: {
      activity_id: activityId,
      activity_name: activityName,
      last_updated: new Date().toISOString(),
      confidence,
      sources,
      verified_by: "researcher-agent",
    },
    body: content,
  };
}

export function buildGotchas(
  activityId: string,
  activityName: string,
  content: string,
  sources: string[],
  confidence: Confidence
): KnowledgeFileContent {
  return {
    frontmatter: {
      activity_id: activityId,
      activity_name: activityName,
      last_updated: new Date().toISOString(),
      confidence,
      sources,
      verified_by: "researcher-agent",
      purpose: "gotchas",
    },
    body: content,
  };
}

export function buildTestDataRecipes(
  activityId: string,
  activityName: string,
  content: string,
  sources: string[],
  confidence: Confidence
): KnowledgeFileContent {
  return {
    frontmatter: {
      activity_id: activityId,
      activity_name: activityName,
      last_updated: new Date().toISOString(),
      confidence,
      sources,
      verified_by: "researcher-agent",
      purpose: "test_data_recipes",
    },
    body: content,
  };
}
