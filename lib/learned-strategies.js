// DealFlow AI Runner — Learned Strategy Manager
// When the AI vision agent resolves a problem, it generates Playwright code
// and saves it here. Future runs try learned strategies before calling AI.
//
// Storage: learned-strategies.json (gitignored — machine-specific learnings)
// Key: taskType string (e.g. "role_file_upload", "worker_import_name")
// Value: array of {code, description, successCount, createdAt}

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fetchAIConfig } from './api.js';

const STRATEGIES_FILE = path.join(process.cwd(), 'learned-strategies.json');

// Load all learned strategies from disk
export async function loadStrategies() {
  try {
    const raw = await readFile(STRATEGIES_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {}; // file doesn't exist yet
  }
}

// Save strategies back to disk
async function saveStrategies(strategies) {
  await writeFile(STRATEGIES_FILE, JSON.stringify(strategies, null, 2), 'utf8');
}

/**
 * Try all learned strategies for a given task type.
 * Executes each strategy's code in a sandboxed eval with the page object.
 * Returns true if one succeeded, false if all failed.
 *
 * @param {Page} page - Playwright page
 * @param {string} taskType - key identifying this task (e.g. "role_file_upload")
 * @param {object} context - variables to inject into strategy code (e.g. { csvPath })
 */
export async function tryLearnedStrategies(page, taskType, context = {}) {
  const strategies = await loadStrategies();
  const taskStrategies = strategies[taskType];
  if (!taskStrategies || taskStrategies.length === 0) return false;

  console.log(`[Learned] Found ${taskStrategies.length} learned strategy(s) for "${taskType}"`);

  for (let i = 0; i < taskStrategies.length; i++) {
    const strategy = taskStrategies[i];
    console.log(`[Learned] Trying strategy ${i + 1}: ${strategy.description}`);

    try {
      // Build an async function from the learned code string
      // Inject page + context variables as named parameters
      const contextKeys = Object.keys(context);
      const contextVals = Object.values(context);
      const fn = new Function('page', ...contextKeys, `return (async () => { ${strategy.code} })()`);
      await fn(page, ...contextVals);

      // Mark success
      strategy.successCount = (strategy.successCount || 0) + 1;
      strategy.lastSuccess = new Date().toISOString();
      strategies[taskType] = taskStrategies;
      await saveStrategies(strategies);

      console.log(`[Learned] ✓ Strategy ${i + 1} succeeded (total successes: ${strategy.successCount})`);
      return true;
    } catch (err) {
      console.warn(`[Learned] Strategy ${i + 1} failed: ${err.message}`);
    }
  }

  console.warn(`[Learned] All learned strategies for "${taskType}" failed — falling back to AI`);
  return false;
}

/**
 * Ask Claude to generate Playwright code from an action sequence.
 * Called automatically when AI vision resolves something.
 * Saves the result to learned-strategies.json.
 *
 * @param {string} taskType - key for this task
 * @param {string} taskDescription - human description of what was being done
 * @param {Array} actionHistory - array of {attempt, action, target, value} from aiResolve
 * @param {string} successMessage - what the AI said when it declared done
 * @param {object} learnContext - extra variables available in learned code (e.g. { csvPath })
 */
export async function learnFromSuccess(taskType, taskDescription, actionHistory, successMessage, learnContext = {}) {
  console.log(`[Learned] Generating Playwright code for task: "${taskType}"...`);

  const aiConfig = await fetchAIConfig();
  if (!aiConfig?.api_key) {
    console.warn("[Learned] No API key — cannot generate learned strategy");
    return;
  }

  const actionSummary = actionHistory
    .map(a => `Attempt ${a.attempt}: ${a.action} → target="${a.target || ''}" value="${a.value || ''}"`)
    .join('\n');

  const prompt = `You are a Playwright automation expert. An AI vision agent just solved a browser automation problem by taking these actions:

TASK: ${taskDescription}
OUTCOME: ${successMessage}

ACTIONS TAKEN:
${actionSummary}

Generate a single self-contained async Playwright code snippet that replicates what the AI did.
The code has access to a variable called "page" (Playwright Page object).
Additional context variables available: " + (Object.keys(learnContext).join(", ") || "none") + ".
The code should NOT include function declarations — just the body statements.
The code should be robust with try/catch and multiple fallback selectors.
Do NOT include markdown, backticks, or explanations — ONLY the raw JavaScript code statements.

Example output format:
const btn = await page.locator('button:has-text("Upload")').first();
await btn.click();
await page.waitForTimeout(1000);`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": aiConfig.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: aiConfig.model || "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error("API error: " + (err.error?.message || response.status));
    }

    const data = await response.json();
    const code = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .replace(/```javascript|```js|```/g, "") // strip any markdown fences
      .trim();

    if (!code) {
      console.warn("[Learned] AI returned empty code — not saving");
      return;
    }

    // Save to strategies file
    const strategies = await loadStrategies();
    if (!strategies[taskType]) strategies[taskType] = [];

    // Check for duplicates (same action sequence)
    const signature = actionHistory.map(a => `${a.action}:${a.target}`).join('|');
    const isDuplicate = strategies[taskType].some(s => s.signature === signature);
    if (isDuplicate) {
      console.log(`[Learned] Strategy already exists for this action sequence — skipping`);
      return;
    }

    strategies[taskType].push({
      description: successMessage.slice(0, 150),
      code,
      signature,
      successCount: 1,
      createdAt: new Date().toISOString(),
      lastSuccess: new Date().toISOString(),
    });

    await saveStrategies(strategies);
    console.log(`[Learned] ✓ New strategy saved for "${taskType}" (${strategies[taskType].length} total)`);
    console.log(`[Learned] Generated code:\n${code}`);

  } catch (err) {
    console.error("[Learned] Failed to generate strategy:", err.message);
  }
}
