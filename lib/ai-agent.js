// DealFlow AI Runner — AI Vision Agent
// When Playwright encounters an unexpected state, this agent:
// 1. Takes a screenshot
// 2. Sends it to Claude Vision API with context
// 3. Parses the response into an executable action
// 4. Executes the action on the page
// 5. Returns control to the calling script

import { readFile } from 'fs/promises';
import { screenshot } from './browser.js';
import { fetchAIConfig } from './api.js';
import { learnFromSuccess, tryLearnedStrategies } from './learned-strategies.js';
export { tryLearnedStrategies }; // re-export for use in scripts

const MAX_AI_ATTEMPTS = 5;  // max AI decisions per single stuck point
const ACTION_TIMEOUT = 10000;

/**
 * Ask Claude to analyze the current page and decide what to do.
 * Returns the raw AI response text.
 */
async function askClaude(imageBase64, taskContext, pageText) {
  const aiConfig = await fetchAIConfig();
  if (!aiConfig?.api_key) throw new Error("No Anthropic API key available");

  const systemPrompt = `You are an AI browser automation agent for SAP systems. You are controlling a Playwright browser to complete provisioning tasks in SAP S/4HANA, SAP IAS, and SAP CBC.

You will be shown a screenshot of the current browser state. Analyze it and respond with the NEXT SINGLE ACTION to take.

Respond with EXACTLY ONE action in this JSON format (no markdown, no explanation):
{"action": "click", "target": "exact visible text of the element"}
{"action": "type", "target": "exact placeholder or label text of the input field", "value": "text to type"}
{"action": "select", "target": "exact visible text of the dropdown or list", "value": "exact option text to select"}
{"action": "wait", "seconds": 3}
{"action": "done", "message": "explanation of why the task appears complete"}
{"action": "error", "message": "explanation of what went wrong"}

CRITICAL: For "click" and "type" actions, the "target" field must be the EXACT TEXT visible on the button, link, or label — NOT a description. 
Examples:
- CORRECT: {"action": "click", "target": "Import"}
- WRONG:   {"action": "click", "target": "Import button in the toolbar"}
- CORRECT: {"action": "click", "target": "OK"}
- WRONG:   {"action": "click", "target": "OK button in the dialog footer"}`;

  const userMessage = `TASK: ${taskContext}

CURRENT PAGE TEXT (partial): ${(pageText || "").slice(0, 2000)}

What is the single next action I should take?`;

  const body = {
    model: aiConfig.model || "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: imageBase64 }
        },
        { type: "text", text: userMessage }
      ]
    }]
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": aiConfig.api_key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error("Claude API error: " + (err.error?.message || r.status));
  }

  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  return text;
}

/**
 * Parse Claude's response into a structured action
 */
function parseAction(response) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.warn("[AI Agent] Failed to parse JSON from response:", response);
  }
  return { action: "error", message: "Could not parse AI response: " + response.slice(0, 200) };
}

/**
 * Execute a single action on the page
 */
async function executeAction(page, action) {
  console.log(`[AI Agent] Executing: ${action.action}`, action.target || action.value || action.message || "");

  switch (action.action) {
    case "click": {
      // Try multiple strategies to find and click the element
      const target = action.target;

      // Strategy 1: text match
      try {
        const el = page.locator(`text=${target}`).first();
        if (await el.isVisible({ timeout: 3000 })) {
          await el.click({ timeout: ACTION_TIMEOUT });
          console.log("[AI Agent] Clicked (text match):", target);
          return true;
        }
      } catch {}

      // Strategy 2: button with text
      try {
        const el = page.locator(`button:has-text("${target}")`).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click({ timeout: ACTION_TIMEOUT });
          console.log("[AI Agent] Clicked (button match):", target);
          return true;
        }
      } catch {}

      // Strategy 3: aria-label
      try {
        const el = page.locator(`[aria-label*="${target}"]`).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click({ timeout: ACTION_TIMEOUT });
          console.log("[AI Agent] Clicked (aria match):", target);
          return true;
        }
      } catch {}

      // Strategy 4: any element containing the text
      try {
        const el = page.locator(`*:has-text("${target}")`).last();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click({ timeout: ACTION_TIMEOUT });
          console.log("[AI Agent] Clicked (broad match):", target);
          return true;
        }
      } catch {}

      console.warn("[AI Agent] Could not find element to click:", target);

      // Last resort: try just the first word of the target (in case AI included extra description)
      const firstWord = target.split(" ")[0];
      if (firstWord && firstWord !== target) {
        try {
          const el = page.locator(`text="${firstWord}"`).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click({ timeout: ACTION_TIMEOUT });
            console.log("[AI Agent] Clicked (first-word fallback):", firstWord);
            return true;
          }
        } catch {}
      }

      return false;
    }

    case "type": {
      const target = action.target;
      const value = action.value || "";

      try {
        // Try by placeholder
        let el = page.locator(`input[placeholder*="${target}"]`).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          await el.fill(value);
          return true;
        }
      } catch {}

      try {
        // Try by label
        let el = page.locator(`input:near(:text("${target}"))`).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          await el.fill(value);
          return true;
        }
      } catch {}

      try {
        // Try by type=text/email/password near the description
        const inputs = await page.$$('input[type="text"], input[type="email"], input[type="password"], input:not([type])');
        if (inputs.length > 0) {
          await inputs[0].fill(value);
          return true;
        }
      } catch {}

      console.warn("[AI Agent] Could not find input field:", target);
      return false;
    }

    case "select": {
      const target = action.target;
      const value = action.value || "";

      // Click the item with the value text
      try {
        const el = page.locator(`text=${value}`).first();
        if (await el.isVisible({ timeout: 3000 })) {
          await el.click({ timeout: ACTION_TIMEOUT });
          return true;
        }
      } catch {}

      // Try select element
      try {
        const sel = page.locator('select').first();
        if (await sel.isVisible({ timeout: 2000 })) {
          await sel.selectOption({ label: value });
          return true;
        }
      } catch {}

      console.warn("[AI Agent] Could not find select element:", target, value);
      return false;
    }

    case "wait": {
      const seconds = action.seconds || 3;
      console.log(`[AI Agent] Waiting ${seconds}s...`);
      await page.waitForTimeout(seconds * 1000);
      return true;
    }

    case "done": {
      console.log("[AI Agent] Task complete:", action.message);
      return { resolved: "done", message: action.message };
    }

    case "error": {
      console.error("[AI Agent] AI reported error:", action.message);
      throw new Error("AI agent: " + action.message);
    }

    default:
      console.warn("[AI Agent] Unknown action:", action.action);
      return false;
  }
}

/**
 * Main entry point — call this when Playwright gets stuck.
 * Loops: screenshot → ask Claude → execute action → repeat until done or max attempts.
 *
 * @param {Page} page - Playwright page
 * @param {string} taskContext - Human-readable description of what we're trying to do
 * @param {object} options - { maxAttempts, credentials }
 * @returns {boolean} - true if AI resolved the issue
 */
export async function aiResolve(page, taskContext, options = {}) {
  const maxAttempts = options.maxAttempts || MAX_AI_ATTEMPTS;
  const credentials = options.credentials || {};
  const taskType = options.taskType || null; // key for learned strategy storage
  const learnContext = options.learnContext || {}; // extra vars (e.g. csvPath) for learned code

  // Add credentials to context if provided
  let fullContext = taskContext;
  if (credentials.username) fullContext += `\nLogin credentials: username="${credentials.username}", password is provided.`;

  console.log(`\n[AI Agent] ━━━ Engaging AI Vision Agent ━━━`);
  console.log(`[AI Agent] Task: ${taskContext}`);

  const actionHistory = []; // track what AI did for diagnostics

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[AI Agent] Attempt ${attempt}/${maxAttempts}`);

    // Take screenshot
    const screenshotPath = await screenshot(page, `ai-agent-attempt-${attempt}`);
    if (!screenshotPath) {
      console.error("[AI Agent] Failed to take screenshot");
      return false;
    }

    // Read screenshot as base64
    const imageBuffer = await readFile(screenshotPath);
    const imageBase64 = imageBuffer.toString("base64");

    // Get page text for additional context
    let pageText = "";
    try {
      pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || "");
    } catch {}

    // Ask Claude
    let response;
    try {
      response = await askClaude(imageBase64, fullContext, pageText);
      console.log("[AI Agent] Claude says:", response.slice(0, 200));
    } catch (err) {
      console.error("[AI Agent] Claude API error:", err.message);
      return false;
    }

    // Parse and execute
    const action = parseAction(response);
    actionHistory.push({ attempt, action: action.action, target: action.target, value: action.value });

    // Handle "type" with password injection
    if (action.action === "type" && action.target?.toLowerCase().includes("password") && credentials.password) {
      action.value = credentials.password;
    }
    if (action.action === "type" && (action.target?.toLowerCase().includes("user") || action.target?.toLowerCase().includes("email")) && credentials.username) {
      action.value = credentials.username;
    }

    try {
      const result = await executeAction(page, action);
      if (result?.resolved === "done") {
        console.log("[AI Agent] ━━━ Task resolved by AI ━━━");
        console.log("[AI Agent] Actions taken:", JSON.stringify(actionHistory));

        // Auto-generate and save Playwright code for future runs
        if (taskType) {
          await learnFromSuccess(taskType, taskContext, actionHistory, result.message, learnContext).catch(err =>
            console.warn("[AI Agent] Could not save learned strategy:", err.message)
          );
        } else {
          console.log("[AI Agent] No taskType set — pass options.taskType to enable auto-learning");
        }
        return true;
      }

      // Wait a moment for page to react
      await page.waitForTimeout(1500);

    } catch (err) {
      console.error("[AI Agent] Action failed:", err.message);
      // Continue to next attempt — AI will see the updated state
    }
  }

  console.warn("[AI Agent] ━━━ Max attempts reached — AI could not resolve ━━━");
  console.warn("[AI Agent] Actions attempted:", JSON.stringify(actionHistory, null, 2));
  console.warn("[AI Agent] ──────────────────────────\n");
  return false;
}

/**
 * Wrapper for any Playwright action — tries the action, falls back to AI if it fails.
 * Use this instead of raw Playwright calls in scripts.
 *
 * @param {Page} page - Playwright page
 * @param {Function} action - async function that performs the Playwright action
 * @param {string} taskContext - what we're trying to do (for AI)
 * @param {object} options - { credentials }
 */
export async function withAIFallback(page, action, taskContext, options = {}) {
  try {
    return await action();
  } catch (err) {
    console.warn(`[AI Agent] Action failed: ${err.message} — engaging AI...`);
    const resolved = await aiResolve(page, taskContext + ` (Error encountered: ${err.message})`, options);
    if (!resolved) throw new Error(`AI agent could not resolve: ${taskContext}`);
    // After AI resolves, try the original action again
    try {
      return await action();
    } catch {
      // AI resolved the blocker but original action still fails — that's OK, the flow continues
      return null;
    }
  }
}
