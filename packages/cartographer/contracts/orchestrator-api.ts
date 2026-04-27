/**
 * Orchestrator API — Enforces lifecycle order, manages job queue.
 * No phase may be skipped. A request to load an activity with no
 * Researcher output queues Research first.
 */

import type { LifecyclePhase } from "./mcp-tools.js";

export type JobType =
  | "research"
  | "discover"
  | "verify"
  | "load"
  | "bulk_load"
  | "repair"
  | "drift_check";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export interface Job {
  id: string;
  type: JobType;
  activity_id: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  result: unknown;
}

export interface OrchestratorAPI {
  submit(type: JobType, activityId: string, params?: Record<string, unknown>): Promise<Job>;
  getJob(jobId: string): Promise<Job | null>;
  listJobs(filter?: { activity_id?: string; status?: JobStatus; type?: JobType }): Promise<Job[]>;
  cancelJob(jobId: string): Promise<void>;
  getRequiredPhase(activityId: string, requestedAction: JobType): Promise<LifecyclePhase>;
  isPhaseComplete(activityId: string, phase: LifecyclePhase): Promise<boolean>;
}
