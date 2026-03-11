// DealFlow AI Runner — IAS User Creation + Group Assignment via SCIM 2.0 API
// Creates users, saves scim_id, assigns IAS groups, sends password reset.

import { updateProjectUser } from '../lib/api.js';

const SCIM_CONTENT = "application/scim+json";

function buildAuthHeader(clientId, clientSecret) {
  return "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64");
}

async function findUserByEmail(baseUrl, authHeader, email) {
  const filter = encodeURIComponent(`emails.value eq "${email}"`);
  const r = await fetch(`${baseUrl}/scim/Users?filter=${filter}&count=1`, {
    headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
  });
  if (!r.ok) return null;
  const data = await r.json();
  return (data.totalResults > 0 && data.Resources?.length > 0) ? data.Resources[0] : null;
}

async function createUser(baseUrl, authHeader, user) {
  const scimBody = {
    schemas: [
      "urn:ietf:params:scim:schemas:core:2.0:User",
      "urn:ietf:params:scim:schemas:extension:sap:2.0:User",
    ],
    userName: user.user_name || user.worker_id || user.email,
    name: { givenName: user.first_name, familyName: user.last_name },
    emails: [{ value: user.email, primary: true }],
    password: "Initial1!",
    "urn:ietf:params:scim:schemas:extension:sap:2.0:User": {
      passwordDetails: { status: "initial" },
      mailVerified: true,
    },
    active: true,
  };
  if (user.phone || user.mobile) {
    scimBody.phoneNumbers = [];
    if (user.phone) scimBody.phoneNumbers.push({ value: user.phone, type: "work" });
    if (user.mobile) scimBody.phoneNumbers.push({ value: user.mobile, type: "mobile" });
  }
  if (user.language) scimBody.locale = user.language.toLowerCase();

  const r = await fetch(`${baseUrl}/scim/Users`, {
    method: "POST",
    headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
    body: JSON.stringify(scimBody),
  });
  const body = await r.json().catch(() => null);
  if (r.status === 201 || r.status === 200) return { created: true, id: body?.id, userName: body?.userName };
  if (r.status === 409) return { created: false, skipped: true, reason: "already_exists" };
  throw new Error(`SCIM create failed (${r.status}): ${body?.detail || body?.message || JSON.stringify(body).slice(0, 300)}`);
}

/**
 * Reset password to Initial1! via SCIM PATCH (initial status = must change on first login).
 */
async function resetPassword(baseUrl, authHeader, scimUserId, email) {
  try {
    const r = await fetch(`${baseUrl}/scim/Users/${scimUserId}`, {
      method: "PATCH",
      headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", value: {
          password: "Initial1!",
          "urn:ietf:params:scim:schemas:extension:sap:2.0:User": {
            passwordDetails: { status: "initial" },
            mailVerified: true,
          },
          active: true,
        }}],
      }),
    });
    if (r.ok || r.status === 204) { console.log(`[IAS] 🔑 Password set to Initial1! for ${email}`); return true; }
    const body = await r.json().catch(() => ({}));
    console.warn(`[IAS] Password reset failed for ${email}: ${r.status} ${body.detail || ""}`);
    return false;
  } catch (err) {
    console.warn(`[IAS] Password reset error for ${email}: ${err.message}`);
    return false;
  }
}

/**
 * Add a user to an IAS group via SCIM PATCH.
 */
async function addUserToGroup(baseUrl, authHeader, groupId, groupName, scimUserId) {
  try {
    const r = await fetch(`${baseUrl}/scim/Groups/${groupId}`, {
      method: "PATCH",
      headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{
          op: "add",
          path: "members",
          value: [{ value: scimUserId }],
        }],
      }),
    });
    if (r.ok || r.status === 204) {
      console.log(`[IAS]   ✓ Added to group: ${groupName}`);
      return true;
    }
    const body = await r.json().catch(() => ({}));
    // 409 = already a member
    if (r.status === 409) {
      console.log(`[IAS]   ↳ Already in group: ${groupName}`);
      return true;
    }
    console.warn(`[IAS]   ✗ Failed to add to group ${groupName}: ${r.status} ${body.detail || ""}`);
    return false;
  } catch (err) {
    console.warn(`[IAS]   ✗ Group add error for ${groupName}: ${err.message}`);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────

export async function runIasCreateUsers({ job, step, users, connection, ias_groups }) {
  const baseUrl = connection.system_url
    .replace(/\/#\/.*$/, "").replace(/\/admin\/?.*$/, "").replace(/\/$/, "");
  const clientId = connection.username || connection.user_name || "";
  const clientSecret = connection.password || "";
  if (!clientId || !clientSecret) throw new Error("IAS credentials missing");

  const authHeader = buildAuthHeader(clientId, clientSecret);
  const userGroups = ias_groups || [];

  console.log(`[IAS] Starting SCIM provisioning for ${users.length} user(s)`);
  console.log(`[IAS] Tenant: ${baseUrl}`);
  console.log(`[IAS] IAS group assignments: ${userGroups.length}`);

  // Verify connectivity
  const testR = await fetch(`${baseUrl}/scim/Users?count=1`, {
    headers: { "Authorization": authHeader, "Content-Type": SCIM_CONTENT },
  });
  if (testR.status === 401) throw new Error("Auth failed — check Client ID / Secret");
  if (testR.status === 403) throw new Error("Forbidden — system user lacks 'Manage Users'");
  if (!testR.ok) throw new Error(`Connectivity test failed: ${testR.status}`);
  console.log("[IAS] SCIM connectivity verified ✓");

  const results = [];
  let created = 0, skipped = 0, failed = 0, resetsSent = 0, groupsAssigned = 0;

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
      console.log(`[IAS] [${label}] Processing ${u.email}...`);
      let scimId = null;
      let wasCreated = false;

      // Check existing
      const existing = await findUserByEmail(baseUrl, authHeader, u.email);
      if (existing) {
        scimId = existing.id;
        console.log(`[IAS] [${label}] Already exists (id: ${scimId})`);
      } else {
        // Create
        const result = await createUser(baseUrl, authHeader, u);
        if (result.created) {
          scimId = result.id;
          wasCreated = true;
          console.log(`[IAS] [${label}] ✓ Created (id: ${scimId})`);
          created++;
        } else if (result.skipped) {
          console.log(`[IAS] [${label}] Skipped: ${result.reason}`);
          results.push({ email: u.email, status: "skipped", reason: result.reason });
          skipped++;
          continue;
        }
      }

      // Save IAS ID back to BTP
      if (scimId) {
        await updateProjectUser(u.id, { ias_user_id: scimId }).catch(e =>
          console.warn(`[IAS] Failed to save IAS ID: ${e.message}`)
        );
      }

      // Assign IAS groups for this user
      if (scimId) {
        const myGroups = userGroups.filter(g => g.project_user_id === u.id);
        if (myGroups.length > 0) {
          console.log(`[IAS] [${label}] Assigning ${myGroups.length} group(s)...`);
          for (const g of myGroups) {
            const ok = await addUserToGroup(baseUrl, authHeader, g.group_id, g.group_name, scimId);
            if (ok) groupsAssigned++;
          }
        }
      }

      // Send password reset for newly created users
      if (scimId && wasCreated) {
        const ok = await resetPassword(baseUrl, authHeader, scimId, u.email);
        if (ok) resetsSent++;
      }

      results.push({
        email: u.email,
        status: wasCreated ? "created" : "existing",
        scim_id: scimId,
        groups_assigned: userGroups.filter(g => g.project_user_id === u.id).length,
      });
      if (!wasCreated && existing) skipped++;

    } catch (err) {
      console.error(`[IAS] [${label}] ✗ Failed: ${u.email} — ${err.message}`);
      results.push({ email: u.email, status: "failed", error: err.message });
      failed++;
    }
  }

  console.log(`\n[IAS] ════════════════════════════════════════`);
  console.log(`[IAS] ${created} created, ${skipped} skipped, ${failed} failed`);
  console.log(`[IAS] ${resetsSent} passwords set (Initial1!), ${groupsAssigned} group assignments`);
  console.log(`[IAS] ════════════════════════════════════════\n`);

  if (failed > 0 && created === 0 && skipped === 0) {
    throw new Error(`All ${failed} user(s) failed`);
  }

  return {
    total_users: users.length, created, skipped, failed,
    resets_sent: resetsSent, groups_assigned: groupsAssigned,
    api_driven: true, results,
    timestamp: new Date().toISOString(),
  };
}
