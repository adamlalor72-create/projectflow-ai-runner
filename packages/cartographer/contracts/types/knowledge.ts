/**
 * CBC Cartographer — Knowledge File Frontmatter Types
 * Generated from schemas/knowledge-frontmatter.schema.json
 */

export type Confidence = "low" | "medium" | "high";

export interface UncertaintyFlag {
  note: string;
  line?: number;
}

export interface KnowledgeFrontmatter {
  activity_id?: string | number | null;
  activity_name?: string;
  last_updated: string;
  confidence: Confidence;
  sources?: string[];
  verified_by: string;
  related_activities?: (string | number)[];
  scope_item_refs?: string[];
  purpose?: string;
  uncertainty_flags?: UncertaintyFlag[];
}
