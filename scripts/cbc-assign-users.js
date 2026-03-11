// DealFlow AI Runner — CBC User Assignment
// Assigns tagged users to Central Business Configuration
// Fully AI-driven — the agent navigates the CBC console

import { newPage, loginToSystem, screenshot } from '../lib/browser.js';
import { aiResolve } from '../lib/ai-agent.js';

export async function runCbcAssignUsers({ job, step, users, connection }) {
  const page = await newPage();
  const creds = { username: connection.username, password: connection.password };

  try {
    const cbcUsers = users.filter(u => u.cbc_tag);
    if (cbcUsers.length === 0) {
      console.log("[CBC] No CBC-tagged users — skipping.");
      return { skipped: true, reason: "No CBC-tagged users" };
    }

    const baseUrl = connection.system_url.replace(/\/$/, "");

    // Step 1: Login to CBC
    console.log("[CBC] Logging into CBC...");
    const loggedIn = await loginToSystem(page, baseUrl, connection.username, connection.password);
    if (!loggedIn) throw new Error("Failed to login to CBC");

    await page.waitForTimeout(3000);

    // Step 2: Navigate to user management and assign each user
    const results = [];
    for (let i = 0; i < cbcUsers.length; i++) {
      const u = cbcUsers[i];
      console.log(`[CBC] Assigning user ${i + 1}/${cbcUsers.length}: ${u.email}`);

      const resolved = await aiResolve(page,
        `I am in SAP Central Business Configuration (CBC). I need to add/assign a user to the project:
- Name: ${u.first_name} ${u.last_name}
- Email: ${u.email}

Navigate to the user management or team members section, add this user, and save. If the user is already listed, skip them. Tell me "done" when complete, or "error" if something went wrong.

If this is not the first user, I may already be in the right section.`,
        { maxAttempts: 10, credentials: creds }
      );

      results.push({ email: u.email, assigned: resolved });
      if (!resolved) {
        console.warn(`[CBC] Failed to assign user: ${u.email}`);
      }
    }

    const assigned = results.filter(r => r.assigned).length;
    console.log(`[CBC] Assigned ${assigned}/${cbcUsers.length} users.`);
    await screenshot(page, "cbc-final");

    return {
      total_cbc_users: cbcUsers.length,
      assigned,
      failed: cbcUsers.length - assigned,
      ai_assisted: true,
      results,
      timestamp: new Date().toISOString(),
    };

  } catch (err) {
    await screenshot(page, "cbc-error");
    throw err;
  } finally {
    await page.close().catch(() => {});
  }
}
