import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MapStore } from "../services/store/index.js";
import { Orchestrator } from "../services/orchestrator/index.js";
import { makeMinimalMap } from "./helpers/fixtures.js";

let store: MapStore;
let orch: Orchestrator;

beforeEach(() => {
  store = new MapStore();
  orch = new Orchestrator(store);
});

afterEach(() => {
  orch.close();
  store.close();
});

describe("Orchestrator", () => {
  describe("submit", () => {
    it("queues a research job with no prerequisites", async () => {
      const job = await orch.submit("research", "102934");
      expect(job.status).toBe("queued");
      expect(job.type).toBe("research");
      expect(job.activity_id).toBe("102934");
      expect(job.id).toBeDefined();
    });

    it("blocks discover when activity is unresearched", async () => {
      const job = await orch.submit("discover", "102934");
      expect(job.status).toBe("blocked");
    });

    it("queues discover when activity is researched", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "102934" }));
      await store.setLifecyclePhase("102934", "researched");

      const job = await orch.submit("discover", "102934");
      expect(job.status).toBe("queued");
    });

    it("blocks verify when activity is only researched", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "102934" }));
      await store.setLifecyclePhase("102934", "researched");

      const job = await orch.submit("verify", "102934");
      expect(job.status).toBe("blocked");
    });

    it("queues verify when activity is discovered", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "102934" }));
      await store.setLifecyclePhase("102934", "discovered");

      const job = await orch.submit("verify", "102934");
      expect(job.status).toBe("queued");
    });

    it("blocks load when activity is not verified", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "102934" }));
      await store.setLifecyclePhase("102934", "discovered");

      const job = await orch.submit("load", "102934");
      expect(job.status).toBe("blocked");
    });

    it("queues load when activity is verified", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "102934" }));
      await store.setLifecyclePhase("102934", "verified");

      const job = await orch.submit("load", "102934");
      expect(job.status).toBe("queued");
    });

    it("queues load when activity is in production (past verified)", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "102934" }));
      await store.setLifecyclePhase("102934", "production");

      const job = await orch.submit("load", "102934");
      expect(job.status).toBe("queued");
    });

    it("stores params as JSON", async () => {
      const job = await orch.submit("research", "102934", { source: "web" });
      const retrieved = await orch.getJob(job.id);
      expect(retrieved).not.toBeNull();
    });
  });

  describe("getJob", () => {
    it("returns null for nonexistent job", async () => {
      const job = await orch.getJob("nonexistent");
      expect(job).toBeNull();
    });

    it("returns a previously submitted job", async () => {
      const submitted = await orch.submit("research", "102934");
      const retrieved = await orch.getJob(submitted.id);
      expect(retrieved!.id).toBe(submitted.id);
      expect(retrieved!.type).toBe("research");
    });
  });

  describe("listJobs", () => {
    it("returns all jobs", async () => {
      await orch.submit("research", "100");
      await orch.submit("research", "200");
      const jobs = await orch.listJobs();
      expect(jobs).toHaveLength(2);
    });

    it("filters by activity_id", async () => {
      await orch.submit("research", "100");
      await orch.submit("research", "200");
      const jobs = await orch.listJobs({ activity_id: "100" });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].activity_id).toBe("100");
    });

    it("filters by status", async () => {
      await orch.submit("research", "100");
      await orch.submit("discover", "100"); // blocked since unresearched

      const queued = await orch.listJobs({ status: "queued" });
      expect(queued).toHaveLength(1);

      const blocked = await orch.listJobs({ status: "blocked" });
      expect(blocked).toHaveLength(1);
    });

    it("filters by type", async () => {
      await orch.submit("research", "100");
      await orch.submit("discover", "100");
      const jobs = await orch.listJobs({ type: "research" });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe("research");
    });
  });

  describe("cancelJob", () => {
    it("cancels a queued job", async () => {
      const job = await orch.submit("research", "100");
      await orch.cancelJob(job.id);
      const updated = await orch.getJob(job.id);
      expect(updated!.status).toBe("cancelled");
      expect(updated!.completed_at).not.toBeNull();
    });

    it("cancels a blocked job", async () => {
      const job = await orch.submit("discover", "100");
      expect(job.status).toBe("blocked");
      await orch.cancelJob(job.id);
      const updated = await orch.getJob(job.id);
      expect(updated!.status).toBe("cancelled");
    });

    it("throws for nonexistent job", async () => {
      await expect(orch.cancelJob("nope")).rejects.toThrow("not found");
    });

    it("throws for already-completed job", async () => {
      const job = await orch.submit("research", "100");
      orch.updateJobStatus(job.id, "completed", { done: true });
      await expect(orch.cancelJob(job.id)).rejects.toThrow("terminal state");
    });
  });

  describe("updateJobStatus", () => {
    it("transitions from queued to running", async () => {
      const job = await orch.submit("research", "100");
      orch.updateJobStatus(job.id, "running");
      const updated = await orch.getJob(job.id);
      expect(updated!.status).toBe("running");
      expect(updated!.started_at).not.toBeNull();
    });

    it("transitions to completed with result", async () => {
      const job = await orch.submit("research", "100");
      orch.updateJobStatus(job.id, "running");
      orch.updateJobStatus(job.id, "completed", { files: 3 });
      const updated = await orch.getJob(job.id);
      expect(updated!.status).toBe("completed");
      expect(updated!.result).toEqual({ files: 3 });
      expect(updated!.completed_at).not.toBeNull();
    });

    it("transitions to failed with error", async () => {
      const job = await orch.submit("research", "100");
      orch.updateJobStatus(job.id, "running");
      orch.updateJobStatus(job.id, "failed", undefined, "timeout");
      const updated = await orch.getJob(job.id);
      expect(updated!.status).toBe("failed");
      expect(updated!.error).toBe("timeout");
    });
  });

  describe("getRequiredPhase", () => {
    it("returns null-equivalent for research", async () => {
      const phase = await orch.getRequiredPhase("100", "research");
      expect(phase).toBe("unresearched");
    });

    it("returns researched for discover", async () => {
      const phase = await orch.getRequiredPhase("100", "discover");
      expect(phase).toBe("researched");
    });

    it("returns verified for load", async () => {
      const phase = await orch.getRequiredPhase("100", "load");
      expect(phase).toBe("verified");
    });
  });

  describe("isPhaseComplete", () => {
    it("returns true for unresearched check on any activity", async () => {
      const result = await orch.isPhaseComplete("100", "unresearched");
      expect(result).toBe(true);
    });

    it("returns false when activity has not reached phase", async () => {
      const result = await orch.isPhaseComplete("100", "researched");
      expect(result).toBe(false);
    });

    it("returns true when activity has passed the phase", async () => {
      await store.saveMap(makeMinimalMap({ activity_id: "100" }));
      await store.setLifecyclePhase("100", "verified");
      const result = await orch.isPhaseComplete("100", "researched");
      expect(result).toBe(true);
    });
  });
});
