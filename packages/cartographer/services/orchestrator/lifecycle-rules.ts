import type { JobType, JobStatus } from "../../contracts/orchestrator-api.js";
import type { LifecyclePhase } from "../../contracts/mcp-tools.js";

export const PHASE_PREREQUISITES: Record<JobType, LifecyclePhase | null> = {
  research: null,
  discover: "researched",
  verify: "discovered",
  load: "verified",
  bulk_load: "verified",
  repair: "discovered",
  drift_check: "verified",
};

export const PHASE_AFTER_COMPLETION: Record<JobType, LifecyclePhase> = {
  research: "researched",
  discover: "discovered",
  verify: "verified",
  load: "production",
  bulk_load: "production",
  repair: "discovered",
  drift_check: "verified",
};

const PHASE_ORDER: LifecyclePhase[] = [
  "unresearched",
  "researched",
  "discovered",
  "verified",
  "production",
];

export function phaseIndex(phase: LifecyclePhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  return idx === -1 ? -1 : idx;
}

export function isPhaseAtLeast(current: LifecyclePhase, required: LifecyclePhase): boolean {
  const ci = phaseIndex(current);
  const ri = phaseIndex(required);
  if (ci === -1 || ri === -1) return false;
  return ci >= ri;
}

export const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);
