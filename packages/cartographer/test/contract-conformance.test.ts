import { describe, it, expect } from "vitest";

describe("Contract conformance", () => {
  it("all contract files export types (trivial baseline)", async () => {
    const contracts = [
      "../contracts/store-api.js",
      "../contracts/orchestrator-api.js",
      "../contracts/load-engine-api.js",
      "../contracts/discovery-api.js",
      "../contracts/verify-api.js",
      "../contracts/repair-api.js",
      "../contracts/drift-api.js",
      "../contracts/librarian-api.js",
      "../contracts/researcher-api.js",
      "../contracts/mcp-tools.js",
    ];

    for (const c of contracts) {
      const mod = await import(c);
      expect(mod).toBeDefined();
    }
  });
});
