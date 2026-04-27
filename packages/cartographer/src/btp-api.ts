import type { CartographerConfig } from "./config.js";

export interface CBCConnection {
  systemUrl: string;
  username: string;
  password: string;
}

async function apiFetch(
  config: CartographerConfig,
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  const url = config.apiUrl + path;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-runner-key": config.runnerApiKey,
    "x-runner-source": config.cfRunner ? "btp" : "local",
    ...(opts.headers as Record<string, string>),
  };

  const res = await fetch(url, { ...opts, headers });
  if (!res.ok && res.status === 401) {
    throw new Error(
      "Runner API key rejected — check DEALFLOW_RUNNER_KEY matches the BTP API server",
    );
  }
  return res;
}

export async function fetchAIConfig(
  config: CartographerConfig,
): Promise<{ api_key: string }> {
  const res = await apiFetch(config, "/api/runner/ai-config");
  if (!res.ok) throw new Error("Failed to fetch AI config: " + res.status);
  return res.json() as Promise<{ api_key: string }>;
}

export async function fetchCBCConnection(
  config: CartographerConfig,
): Promise<CBCConnection> {
  const res = await apiFetch(config, "/api/runner/connections");
  if (!res.ok)
    throw new Error("Failed to fetch connections: " + res.status);

  const data = (await res.json()) as Record<
    string,
    { system_url?: string; username?: string; user_name?: string; password?: string }
  >;
  const cbc = data.cbc;
  if (!cbc?.system_url) {
    throw new Error("No CBC connection configured in System Connections");
  }

  return {
    systemUrl: cbc.system_url.replace(/\/$/, ""),
    username: cbc.username || cbc.user_name || "",
    password: cbc.password || "",
  };
}

export async function resolveConfig(
  config: CartographerConfig,
): Promise<{ config: CartographerConfig; connection: CBCConnection | null }> {
  let resolved = { ...config };
  let connection: CBCConnection | null = null;

  if (!resolved.anthropicApiKey && resolved.runnerApiKey) {
    console.log("[Config] Fetching Anthropic API key from BTP...");
    const aiConfig = await fetchAIConfig(resolved);
    if (aiConfig.api_key?.startsWith("sk-ant-")) {
      resolved = { ...resolved, anthropicApiKey: aiConfig.api_key };
      console.log("[Config] Anthropic API key resolved from BTP.");
    }
  }

  if (!resolved.anthropicApiKey) {
    throw new Error(
      "No Anthropic API key — set ANTHROPIC_API_KEY or DEALFLOW_RUNNER_KEY",
    );
  }

  if (resolved.runnerApiKey) {
    try {
      connection = await fetchCBCConnection(resolved);
      if (!resolved.cbcBaseUrl) {
        resolved = { ...resolved, cbcBaseUrl: connection.systemUrl };
      }
      console.log(`[Config] CBC connection: ${connection.systemUrl}`);
    } catch (err) {
      console.warn(
        `[Config] Could not fetch CBC connection: ${(err as Error).message}`,
      );
    }
  }

  return { config: resolved, connection };
}
