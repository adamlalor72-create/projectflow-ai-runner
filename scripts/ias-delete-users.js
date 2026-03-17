// DealFlow AI Runner — IAS User Deletion via SCIM 2.0 API
// Deletes users from IAS tenant using their SCIM ID.

import { updateProjectUser } from '../lib/api.js';

const SCIM_CONTENT = "application/scim+json";

function buildAuthHeader(clientId, clientSecret) {
  return "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64");
}

async function deleteUser(baseUrl, authHeader, scimId) {
  const r = await fetch(`${baseUrl}/scim/Users/${scimId}`, {
    method: "DELETE",
    headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
  });
  if (r.status === 204 || r.status === 200) return { deleted: true };
  if (r.status === 404) return { deleted: false, reason: "not_found" };
  const body = await r.json().catch(() => ({}));
  throw new Error(`SCIM delete failed (${r.status}): ${body?.detail || body?.message || "unknown"}`);
}

// ── Main ──────────────────────────────────────────────────────

export async function runIasDeleteUsers({ job, step, users, connection }) {
  const baseUrl = connection.system_url
    .replace(/\/#\/.*$/, "").replace(/\/admin\/?.*$/, "").replace(/\/$/, "");
  const clientId = connection.username || connection.user_name || "";
  const clientSecret = connection.password || "";
  if (!clientId || !clientSecret) throw new Error("IAS credentials missing");

  const authHeader = buildAuthHeader(clientId, clientSecret);

  console.log(`[IAS-DEL] Starting SCIM deletion for ${users.length} user(s)`);
  console.log(`[IAS-DEL] Tenant: ${baseUrl}`);

  // Verify connectivity
  const testR = await fetch(`${baseUrl}/scim/Users?count=1`, {
    headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
  });
  if (testR.status === 401) throw new Error("Auth failed — check Client ID / Secret");
  if (testR.status === 403) throw new Error("Forbidden — system user lacks 'Manage Users'");
  if (!testR.ok) throw new Error(`Connectivity test failed: ${testR.status}`);
  console.log("[IAS-DEL] SCIM connectivity verified ✓");

  const results = [];
  let deleted = 0, skipped = 0, failed = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const label = `${i + 1}/${users.length}`;
    const scimId = u.ias_user_id;

    if (!scimId) {
      console.warn(`[IAS-DEL] [${label}] Skipping ${u.worker_id || "?"} — no IAS SCIM ID`);
      results.push({ worker_id: u.worker_id, status: "skipped", reason: "no_scim_id" });
      skipped++;
      continue;
    }

    try {
      console.log(`[IAS-DEL] [${label}] Deleting ${u.email || u.worker_id} (scim: ${scimId})...`);
      const result = await deleteUser(baseUrl, authHeader, scimId);

      if (result.deleted) {
        console.log(`[IAS-DEL] [${label}] ✓ Deleted`);
        deleted++;
        results.push({ worker_id: u.worker_id, email: u.email, status: "deleted", scim_id: scimId });
      } else {
        console.log(`[IAS-DEL] [${label}] Not found in IAS (already deleted?)`);
        skipped++;
        results.push({ worker_id: u.worker_id, status: "skipped", reason: result.reason });
      }
    } catch (err) {
      console.error(`[IAS-DEL] [${label}] ✗ Failed: ${err.message}`);
      failed++;
      results.push({ worker_id: u.worker_id, status: "failed", error: err.message });
    }
  }

  console.log(`\n[IAS-DEL] ════════════════════════════════════════`);
  console.log(`[IAS-DEL] ${deleted} deleted, ${skipped} skipped, ${failed} failed`);
  console.log(`[IAS-DEL] ════════════════════════════════════════\n`);

  if (failed > 0 && deleted === 0 && skipped === 0) {
    throw new Error(`All ${failed} user(s) failed`);
  }

  return {
    total_users: users.length, deleted, skipped, failed,
    api_driven: true, results,
    timestamp: new Date().toISOString(),
  };
}
