// ProjectFlow AI Runner — AI Vision Agent v3
// Pure coordinate-based clicking. Uses Claude Sonnet for reliable JSON output.

import { readFile } from 'fs/promises';
import { screenshot } from './browser.js';
import { fetchAIConfig } from './api.js';

const MAX_AI_ATTEMPTS = 15;
const VIEWPORT = { width: 1440, height: 900 };

async function askClaude(imageBase64, taskContext) {
  const aiConfig = await fetchAIConfig();
  if (!aiConfig?.api_key) throw new Error("No Anthropic API key available");

  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 250,
    system: `You are a browser automation agent. You see a ${VIEWPORT.width}x${VIEWPORT.height} screenshot and must respond with EXACTLY ONE JSON object, nothing else.

Available actions:
{"action":"click_xy","x":INT,"y":INT}
{"action":"type","x":INT,"y":INT,"value":"TEXT"}
{"action":"scroll","direction":"down"}
{"action":"wait","seconds":INT}
{"action":"done","message":"TEXT"}

Rules: Use click_xy with pixel coordinates. Estimate the CENTER of the element to click. For text fields, use type with the field coordinates. Output ONLY the JSON object.`,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } },
        { type: "text", text: taskContext }
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
    throw new Error("API error: " + (err.error?.message || r.status));
  }

  const data = await r.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}

function parseAction(response) {
  try { return JSON.parse(response.trim()); } catch {}
  try {
    const matches = response.match(/\{[^{}]*\}/g);
    if (matches) for (const m of matches) {
      try { const p = JSON.parse(m); if (p.action) return p; } catch {}
    }
  } catch {}
  const xy = response.match(/["']?x["']?\s*[:=]\s*(\d+).*?["']?y["']?\s*[:=]\s*(\d+)/);
  if (xy) return { action: "click_xy", x: parseInt(xy[1]), y: parseInt(xy[2]) };
  return { action: "wait", seconds: 2 };
}

async function executeAction(page, action, credentials) {
  console.log(`[AI] ${JSON.stringify(action).slice(0, 100)}`);

  switch (action.action) {
    case "click_xy":
      await page.mouse.click(action.x || 0, action.y || 0);
      return true;

    case "type": {
      let val = action.value || "";
      if (action.x && action.y) { await page.mouse.click(action.x, action.y); await page.waitForTimeout(300); }
      await page.keyboard.press("Meta+a");
      await page.keyboard.type(val, { delay: 30 });
      await page.keyboard.press("Enter");
      return true;
    }

    case "scroll":
      await page.mouse.wheel(0, action.direction === "up" ? -400 : 400);
      return true;

    case "wait":
      await page.waitForTimeout((action.seconds || 2) * 1000);
      return true;

    case "done":
      console.log("[AI] Done:", action.message);
      return "done";

    default: return false;
  }
}

export async function aiResolve(page, taskContext, options = {}) {
  const maxAttempts = options.maxAttempts || MAX_AI_ATTEMPTS;
  const creds = options.credentials || {};

  let ctx = taskContext;
  if (creds.username) ctx += ` [Login: ${creds.username}]`;

  console.log(`\n[AI] ━━━ Vision Agent v3 (Sonnet + coordinates) ━━━`);
  console.log(`[AI] Task: ${taskContext.slice(0, 80)}`);

  const history = []; // Track previous actions to avoid repetition

  for (let i = 1; i <= maxAttempts; i++) {
    console.log(`[AI] Attempt ${i}/${maxAttempts}`);

    const ssPath = await screenshot(page, `ai-${i}`);
    if (!ssPath) return false;

    const img = (await readFile(ssPath)).toString("base64");

    // Build context with history of previous actions
    let fullCtx = ctx;
    if (history.length > 0) {
      fullCtx += "\n\nPREVIOUS ACTIONS THIS STEP (do NOT repeat if they didn't work):\n" + 
        history.map((h, j) => `${j+1}. ${h}`).join("\n");
    }

    let resp;
    try {
      resp = await askClaude(img, fullCtx);
      console.log("[AI] →", resp.slice(0, 100));
    } catch (err) {
      console.error("[AI] API:", err.message);
      return false;
    }

    const action = parseAction(resp);
    history.push(JSON.stringify(action).slice(0, 80));

    try {
      const result = await executeAction(page, action, creds);
      if (result === "done") { console.log("[AI] ━━━ Resolved ━━━\n"); return true; }
      await page.waitForTimeout(1500);
    } catch (err) {
      console.error("[AI] Failed:", err.message);
      history[history.length - 1] += " (FAILED: " + err.message.slice(0, 50) + ")";
    }
  }

  console.warn("[AI] ━━━ Max attempts ━━━\n");
  return false;
}

export async function withAIFallback(page, action, taskContext, options = {}) {
  try { return await action(); } catch (err) {
    console.warn(`[AI] Fallback: ${err.message}`);
    const ok = await aiResolve(page, taskContext + ` (Error: ${err.message})`, options);
    if (!ok) throw new Error(`AI could not resolve: ${taskContext}`);
    try { return await action(); } catch { return null; }
  }
}

export async function tryLearnedStrategies() { return false; }
