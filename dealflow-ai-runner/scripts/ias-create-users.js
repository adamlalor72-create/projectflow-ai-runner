// DealFlow AI Runner — IAS User Creation via SCIM 2.0 API
// Creates users in SAP Identity Authentication Service using direct HTTP calls.
// No browser automation needed — IAS exposes a standard SCIM endpoint.
//
// Auth: Basic Auth with IAS System User credentials (Client ID + Client Secret).
// Endpoint: POST https://<tenant>.accounts.ondemand.com/scim/Users
// Docs: https://api.sap.com/api/IAS_SCIM/resource

const SCIM_CONTENT = "application/scim+json";

function buildAuthHeader(clientId, clientSecret) {
  return "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64");
}

/**
 * Check if a user already exists in IAS by email.
 * Returns the SCIM user object if found, null otherwise.
 */
async function findUserByEmail(baseUrl, authHeader, email) {
  const filter = encodeURIComponent(`emails.value eq "${email}"`);
  const url = `${baseUrl}/scim/Users?filter=${filter}&count=1`;

  const r = await fetch(url, {
    method: "GET",
    headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    console.warn(`[IAS] Lookup failed for ${email}: ${r.status} ${body.slice(0, 200)}`);
    return null;
  }

  const data = await r.json();
  if (data.totalResults > 0 && data.Resources?.length > 0) {
    return data.Resources[0];
  }
  return null;
}

/**
 * Create a user in IAS via SCIM POST.
 * Returns { created: true, id, userName } on success.
 */
async function createUser(baseUrl, authHeader, user) {
  const scimBody = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName: user.user_name || user.worker_id || user.email,
    name: {
      givenName: user.first_name,
      familyName: user.last_name,
    },
    emails: [{
      value: user.email,
      primary: true,
    }],
    active: true,
  };

  if (user.phone || user.mobile) {
    scimBody.phoneNumbers = [];
    if (user.phone) scimBody.phoneNumbers.push({ value: user.phone, type: "work" });
    if (user.mobile) scimBody.phoneNumbers.push({ value: user.mobile, type: "mobile" });
  }

  if (user.language) {
    scimBody.locale = user.language.toLowerCase();
  }

  const r = await fetch(`${baseUrl}/scim/Users`, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": SCIM_CONTENT,
    },
    body: JSON.stringify(scimBody),
  });

  const body = await r.json().catch(() => null);

  if (r.status === 201 || r.status === 200) {
    return { created: true, id: body?.id, userName: body?.userName };
  }

  // 409 = conflict (user already exists)
  if (r.status === 409) {
    console.warn(`[IAS] User ${user.email} already exists (409 conflict)`);
    return { created: false, skipped: true, reason: "already_exists" };
  }

  const detail = body?.detail || body?.message || JSON.stringify(body).slice(0, 300);
  throw new Error(`SCIM create failed (${r.status}): ${detail}`);
}

/**
 * Trigger activation for a newly created user via SCIM PATCH.
 * Non-blocking — if it fails, user is still created.
 */
async function sendActivationEmail(baseUrl, authHeader, scimUserId) {
  try {
    const r = await fetch(`${baseUrl}/scim/Users/${scimUserId}`, {
      method: "PATCH",
      headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: true }],
      }),
    });
    if (r.ok) console.log(`[IAS] Activation triggered for user ${scimUserId}`);
  } catch (err) {
    console.warn(`[IAS] Activation email attempt failed (non-blocking): ${err.message}`);
  }
}

// ── Main entry point ──────────────────────────────────────────

export async function runIasCreateUsers({ job, step, users, connection }) {
  // Connection: system_url = IAS tenant URL, username = Client ID, password = Client Secret
  const baseUrl = connection.system_url.replace(/\/$/, "").replace(/\/admin\/?$/, "").replace(/\/#\/.*$/, "");
  const clientId = connection.username || connection.user_name || "";
  const clientSecret = connection.password || "";

  if (!clientId || !clientSecret) {
    throw new Error("IAS credentials missing — set Client ID and Client Secret in System Connections");
  }

  const authHeader = buildAuthHeader(clientId, clientSecret);
  console.log(`[IAS] Starting SCIM user creation for ${users.length} user(s)`);
  console.log(`[IAS] Tenant: ${baseUrl}`);

  // Verify connectivity
  try {
    const testR = await fetch(`${baseUrl}/scim/Users?count=1`, {
      headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
    });
    if (testR.status === 401) throw new Error("Authentication failed — check Client ID and Client Secret");
    if (testR.status === 403) throw new Error("Forbidden — system user may lack 'Manage Users' authorization");
    if (!testR.ok) throw new Error(`Connectivity test failed: ${testR.status}`);
    console.log("[IAS] SCIM connectivity verified ✓");
  } catch (err) {
    if (err.message.includes("fetch failed") || err.message.includes("ENOTFOUND")) {
      throw new Error(`Cannot reach IAS at ${baseUrl} — check System URL`);
    }
    throw err;
  }

  const results = [];
  let created = 0, skipped = 0, failed = 0;

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const label = `${i + 1}/${users.length}`;

    if (!u.email) {
      console.warn(`[IAS] [${label}] Skipping ${u.worker_id || "?"} — no email`);
      results.push({ worker_id: u.worker_id, status: "skipped", reason: "no_email" });
      skipped++;
      continue;
    }

    try {
      // Check for existing user
      console.log(`[IAS] [${label}] Checking ${u.email}...`);
      const existing = await findUserByEmail(baseUrl, authHeader, u.email);

      if (existing) {
        console.log(`[IAS] [${label}] ${u.email} already exists (id: ${existing.id}) — skipping`);
        results.push({ email: u.email, status: "skipped", reason: "already_exists", scim_id: existing.id });
        skipped++;
        continue;
      }

      // Create user via SCIM
      console.log(`[IAS] [${label}] Creating ${u.first_name} ${u.last_name} (${u.email})...`);
      const result = await createUser(baseUrl, authHeader, u);

      if (result.created) {
        console.log(`[IAS] [${label}] ✓ Created: ${u.email} (id: ${result.id})`);
        if (result.id) await sendActivationEmail(baseUrl, authHeader, result.id);
        results.push({ email: u.email, status: "created", scim_id: result.id, userName: result.userName });
        created++;
      } else if (result.skipped) {
        console.log(`[IAS] [${label}] Skipped: ${u.email} (${result.reason})`);
        results.push({ email: u.email, status: "skipped", reason: result.reason });
        skipped++;
      }
    } catch (err) {
      console.error(`[IAS] [${label}] ✗ Failed: ${u.email} — ${err.message}`);
      results.push({ email: u.email, status: "failed", error: err.message });
      failed++;
    }
  }

  console.log(`\n[IAS] ════════════════════════════════════════`);
  console.log(`[IAS] Results: ${created} created, ${skipped} skipped, ${failed} failed (${users.length} total)`);
  console.log(`[IAS] ════════════════════════════════════════\n`);

  if (failed > 0 && created === 0 && skipped === 0) {
    throw new Error(`All ${failed} user(s) failed — check IAS credentials and permissions`);
  }

  return {
    total_users: users.length,
    created,
    skipped,
    failed,
    api_driven: true,
    results,
    timestamp: new Date().toISOString(),
  };
}
