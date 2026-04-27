import type { StoreAPI } from "../../contracts/store-api.js";
import type { OrchestratorAPI } from "../../contracts/orchestrator-api.js";
import type { LoadEngineAPI } from "../../contracts/load-engine-api.js";
import type { ResearcherAPI } from "../../contracts/researcher-api.js";
import type { DiscoveryAPI } from "../../contracts/discovery-api.js";
import type { VerifyAPI } from "../../contracts/verify-api.js";
import type { DriftAPI } from "../../contracts/drift-api.js";
import type { LibrarianAPI } from "../../contracts/librarian-api.js";
import type {
  ListActivitiesInput,
  ListActivitiesOutput,
  DescribeActivityInput,
  DescribeActivityOutput,
  LoadActivityInput,
  LoadActivityOutput,
  BulkLoadInput,
  BulkLoadOutput,
  DiscoverActivityInput,
  DiscoverActivityOutput,
  VerifyActivityInput,
  VerifyActivityOutput,
  DiffActivityInput,
  DiffActivityOutput,
  ResearchActivityInput,
  ResearchActivityOutput,
} from "../../contracts/mcp-tools.js";

export interface MCPServerDeps {
  store: StoreAPI;
  orchestrator: OrchestratorAPI;
  loadEngine?: LoadEngineAPI;
  researcher?: ResearcherAPI;
  discovery?: DiscoveryAPI;
  verify?: VerifyAPI;
  drift?: DriftAPI;
  librarian?: LibrarianAPI;
}

export class MCPServer {
  private deps: MCPServerDeps;

  constructor(deps: MCPServerDeps) {
    this.deps = deps;
  }

  async listActivities(input: ListActivitiesInput): Promise<ListActivitiesOutput> {
    const activities = await this.deps.store.listActivities(
      input.filter
        ? {
            verified: input.filter.verified,
            lifecycle_phase: input.filter.lifecycle_phase,
          }
        : undefined
    );

    const offset = input.offset ?? 0;
    const limit = input.limit ?? activities.length;
    const sliced = activities.slice(offset, offset + limit);

    return {
      activities: sliced.map((a) => ({
        activity_id: a.activity_id,
        name: a.name,
        verified: a.verified,
        verified_at: null,
        version: a.version,
        lifecycle_phase: a.lifecycle_phase,
      })),
      total: activities.length,
    };
  }

  async describeActivity(input: DescribeActivityInput): Promise<DescribeActivityOutput> {
    const map = await this.deps.store.getMap(input.activity_id);
    if (!map) {
      throw new Error(`Activity ${input.activity_id} not found`);
    }

    const phase = await this.deps.store.getLifecyclePhase(input.activity_id);

    return {
      map,
      knowledge: null,
      lifecycle_phase: phase,
    };
  }

  async loadActivity(input: LoadActivityInput): Promise<LoadActivityOutput> {
    if (!this.deps.loadEngine) {
      throw new Error("Load Engine not available");
    }

    const map = await this.deps.store.getMap(input.activity_id);
    if (!map) {
      throw new Error(`Activity ${input.activity_id} not found`);
    }

    const result = await this.deps.loadEngine.load(map, input.data, {
      dry_run: input.dry_run,
      screenshot_on_error: true,
    });

    return {
      success: result.success,
      fields_set: result.fields_set,
      errors: result.errors.map((e) => `${e.field_id}: ${e.error}`),
      screenshots: result.screenshots,
      duration_ms: result.duration_ms,
    };
  }

  async bulkLoad(input: BulkLoadInput): Promise<BulkLoadOutput> {
    if (!this.deps.loadEngine) {
      throw new Error("Load Engine not available");
    }

    const start = Date.now();
    const results: BulkLoadOutput["results"] = [];

    for (const item of input.items) {
      const map = await this.deps.store.getMap(item.activity_id);
      if (!map) {
        results.push({
          activity_id: item.activity_id,
          success: false,
          errors: [`Activity ${item.activity_id} not found`],
          duration_ms: 0,
        });
        if (input.stop_on_error) break;
        continue;
      }

      const result = await this.deps.loadEngine.load(map, item.data, {
        dry_run: input.dry_run,
        screenshot_on_error: true,
      });

      results.push({
        activity_id: item.activity_id,
        success: result.success,
        errors: result.errors.map((e) => `${e.field_id}: ${e.error}`),
        duration_ms: result.duration_ms,
      });

      if (input.stop_on_error && !result.success) break;
    }

    return {
      results,
      total_duration_ms: Date.now() - start,
    };
  }

  async discoverActivity(input: DiscoverActivityInput): Promise<DiscoverActivityOutput> {
    if (!this.deps.discovery) {
      throw new Error("Discovery Agent not available");
    }

    const result = await this.deps.discovery.discover(input.activity_id, {
      activity_name: input.activity_name,
      force: input.force,
    });

    return {
      map: result.map,
      is_new: result.is_new,
      fields_found: result.fields_found,
      cost_usd: result.cost_usd,
      duration_ms: result.duration_ms,
    };
  }

  async verifyActivity(input: VerifyActivityInput): Promise<VerifyActivityOutput> {
    if (!this.deps.verify) {
      throw new Error("Verify Loop not available");
    }

    const map = await this.deps.store.getMap(input.activity_id);
    if (!map) {
      throw new Error(`Activity ${input.activity_id} not found`);
    }

    const result = await this.deps.verify.verify(map, {
      max_iterations: input.max_iterations,
    });

    return {
      passed: result.passed,
      iterations: result.iterations,
      failures: result.records
        .filter((r) => !r.passed)
        .flatMap((r) => r.errors ?? []),
      map_version: result.final_map.version,
      cost_usd: result.cost_usd,
      duration_ms: result.duration_ms,
    };
  }

  async diffActivity(input: DiffActivityInput): Promise<DiffActivityOutput> {
    if (!this.deps.drift) {
      throw new Error("Drift Monitor not available");
    }

    const result = await this.deps.drift.check(input.activity_id);
    const map = await this.deps.store.getMap(input.activity_id);

    return {
      has_drift: result.has_drift,
      signals: result.signals,
      last_verified_at: map?.verified_at ?? null,
      current_version: map?.version ?? 0,
    };
  }

  async researchActivity(input: ResearchActivityInput): Promise<ResearchActivityOutput> {
    if (!this.deps.researcher) {
      throw new Error("Researcher Agent not available");
    }

    return this.deps.researcher.research(input);
  }

  getToolDefinitions(): Array<{ name: string; description: string }> {
    return [
      { name: "list_activities", description: "List all mapped CBC activities with optional filters" },
      { name: "describe_activity", description: "Get full UI Map and knowledge for an activity" },
      { name: "load_activity", description: "Load data into a CBC activity using its verified UI Map" },
      { name: "bulk_load", description: "Load data into multiple CBC activities in sequence" },
      { name: "discover_activity", description: "Walk a CBC activity UI and produce a UI Map" },
      { name: "verify_activity", description: "Test a UI Map with synthetic data" },
      { name: "diff_activity", description: "Check for UI drift on a mapped activity" },
      { name: "research_activity", description: "Research a CBC activity and seed knowledge" },
      { name: "get_activity_knowledge", description: "Retrieve knowledge files for an activity" },
      { name: "search_knowledge", description: "Search the knowledge base" },
      { name: "get_failure_patterns", description: "Get common failure patterns" },
      { name: "get_general_patterns", description: "Get general knowledge patterns" },
    ];
  }
}
