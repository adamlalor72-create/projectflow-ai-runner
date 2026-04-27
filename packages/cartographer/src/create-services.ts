import type { PageAdapter } from "../contracts/types/page-adapter.js";
import path from "node:path";
import type { CartographerConfig } from "./config.js";
import { AnthropicLLMClient } from "./llm-client.js";
import { MapStore } from "../services/store/index.js";
import { Orchestrator } from "../services/orchestrator/index.js";
import { LoadEngine } from "../services/load-engine/index.js";
import { Researcher } from "../services/researcher/index.js";
import { DiscoveryAgent } from "../services/discovery/index.js";
import { VerifyLoop } from "../services/verify/index.js";
import { RepairAgent } from "../services/repair/index.js";
import { DriftMonitor } from "../services/drift/index.js";
import { Librarian } from "../services/librarian/index.js";
import { MCPServer } from "../services/mcp/index.js";

export interface ServiceContainer {
  store: MapStore;
  orchestrator: Orchestrator;
  loadEngine: LoadEngine | null;
  researcher: Researcher;
  discovery: DiscoveryAgent | null;
  verifyLoop: VerifyLoop | null;
  repairAgent: RepairAgent | null;
  drift: DriftMonitor | null;
  librarian: Librarian;
  mcp: MCPServer;
  close(): void;
}

export function createServices(
  config: CartographerConfig,
  page?: PageAdapter,
): ServiceContainer {
  const store = new MapStore({ dbPath: config.dbPath });
  const orchestrator = new Orchestrator(store, { dbPath: config.dbPath });
  const llm = new AnthropicLLMClient(config.anthropicApiKey);

  const loadEngine = page ? new LoadEngine(page) : null;
  const repairAgent = page ? new RepairAgent({ page, llm }) : null;
  const discovery = page ? new DiscoveryAgent({ page, llm, store }) : null;
  const drift = page ? new DriftMonitor({ page, store }) : null;

  const verifyLoop =
    loadEngine && repairAgent
      ? new VerifyLoop({ loadEngine, repairAgent, store })
      : null;

  const researcher = new Researcher({
    llm,
    knowledgeRoot: path.join(config.knowledgeRoot, "activities"),
  });

  const librarian = new Librarian({
    store,
    dbPath: config.dbPath,
    knowledgeRoot: config.knowledgeRoot,
  });

  const mcp = new MCPServer({
    store,
    orchestrator,
    loadEngine: loadEngine ?? undefined,
    researcher,
    discovery: discovery ?? undefined,
    verify: verifyLoop ?? undefined,
    drift: drift ?? undefined,
    librarian,
  });

  return {
    store,
    orchestrator,
    loadEngine,
    researcher,
    discovery,
    verifyLoop,
    repairAgent,
    drift,
    librarian,
    mcp,
    close() {
      orchestrator.close();
      store.close();
      librarian.close();
    },
  };
}
