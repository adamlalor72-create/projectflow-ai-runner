// DealFlow AI Runner — BTP API Client
// Handles authentication and all API calls to the BTP backend
// Uses a shared API key for runner ↔ BTP communication (no IAS user login needed)

import config from '../config.js';

async function apiFetch(path, opts = {}) {
  const url = config.apiUrl + path;
  const headers = {
    "Content-Type": "application/json",
    "x-runner-key": config.runnerApiKey,
    ...opts.headers,
  };

  const r = await fetch(url, { ...opts, headers });

  if (!r.ok && r.status === 401) {
    throw new Error("Runner API key rejected — check DEALFLOW_RUNNER_KEY matches the BTP API server env var");
  }

  return r;
}

// ── Public API ────────────────────────────────────────────────

export async function fetchQueuedJobs() {
  const r = await apiFetch("/api/runner/jobs");
  if (!r.ok) throw new Error("Failed to fetch jobs: " + r.status);
  return r.json();
}

export async function fetchJobDetail(jobId) {
  const r = await apiFetch("/api/runner/job/" + jobId);
  if (!r.ok) throw new Error("Failed to fetch job detail: " + r.status);
  return r.json();
}

export async function updateJob(jobId, data) {
  const r = await apiFetch("/api/runner/job/" + jobId, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!r.ok) console.error("[API] Failed to update job:", r.status);
}

export async function updateStep(stepId, data) {
  const r = await apiFetch("/api/runner/step/" + stepId, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!r.ok) console.error("[API] Failed to update step:", r.status);
}

export async function updateProjectUser(userId, data) {
  const r = await apiFetch("/api/runner/project-user/" + userId, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  if (!r.ok) console.error("[API] Failed to update project user:", r.status);
  return r.ok;
}

// Fetch Anthropic API key from BTP AI Settings
let _aiConfig = null;
export async function fetchAIConfig() {
  if (_aiConfig) return _aiConfig;
  const r = await apiFetch("/api/runner/ai-config");
  if (!r.ok) throw new Error("Failed to fetch AI config: " + r.status);
  _aiConfig = await r.json();
  return _aiConfig;
}

// Generate CSV content from user data (used by scripts)
export function generateWorkerCSV(users, includeCompanyCode = true) {
  // includeCompanyCode=true  → "Worker and Work Agreement" import template (15 cols)
  // includeCompanyCode=false → simple "Worker" import template (13 cols)
  let h = "*WorkerID,UserName,*WorkerType (BUP003[Employee]/BBP005[Contingent Worker]),Is Contingent Worker of[*for BBP005],*FirstName,*LastName,FullName,Email,PhoneNumber,MobilePhoneNumber,Language";
  if (includeCompanyCode) h += ",*CompanyCode,CostCenter";
  h += ",*StartDate(YYYYMMDD),*EndDate(YYYYMMDD)";

  const rows = users.map(u => {
    const fields = [
      u.worker_id, u.user_name || u.worker_id,
      u.worker_type || "BUP003", u.contingent_of || "",
      u.first_name, u.last_name,
      u.full_name || (u.first_name + " " + u.last_name),
      u.email || "", u.phone || "", u.mobile || "",
      u.language || "EN",
    ];
    if (includeCompanyCode) fields.push(u.company_code || "", u.cost_center || "");
    fields.push(u.start_date || "20250101", u.end_date || "99991231");
    return fields.join(",");
  });

  return h + "\r\n" + rows.join("\r\n");
}

export function generateRoleCSV(users, roles) {
  // BOM required to match SAP template exactly — S/4 expects UTF-8 with BOM
  const BOM = "\uFEFF";
  const h = "User Name;User ID (Optional);E-Mail;Global User ID;Business Role ID";
  const rows = [];
  users.forEach(u => {
    const userRoles = roles.filter(r => r.project_user_id === u.id);
    userRoles.forEach(r => {
      rows.push([u.user_name || u.worker_id, "", u.email || "", "", r.role_id].join(";"));
    });
  });
  // Diagnostic logging
  console.log(`[CSV] generateRoleCSV: ${users.length} users, ${roles.length} roles → ${rows.length} data rows`);
  if (rows.length === 0 && roles.length > 0) {
    console.warn("[CSV] WARNING: roles exist but no rows generated — possible ID mismatch");
    console.warn("[CSV] User IDs:", users.slice(0, 3).map(u => u.id));
    console.warn("[CSV] Role project_user_ids:", roles.slice(0, 3).map(r => r.project_user_id));
  }
  return BOM + h + "\r\n" + rows.join("\r\n");
}
