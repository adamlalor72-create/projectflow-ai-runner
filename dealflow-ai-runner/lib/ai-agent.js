// ProjectFlow AI Runner — AI Vision Agent v4.1
// Uses Anthropic Computer Use API (computer_20250124) for accurate
// screenshot-to-coordinate automation.
//
// v4.1 fixes:
// - Viewport 1024×768 (matches Anthropic training data, smaller screenshots)
// - Conversation history trimming (keep last 3 screenshots to stay under token limits)
// - Retry with exponential backoff on 429 rate limit errors
// - Page viewport resized to match declared CU viewport for coordinate accuracy

import { readFile, mkdir } from 'fs/promises';
import path from 'path';
import { fetchAIConfig } from './api.js';

const MAX_ITERATIONS = 25;
// 1024×768 matches Anthropic's reference implementation and training data
const VIEWPORT = { width: 1024, height: 768 };
const MODEL = "claude-sonnet-4-20250514";
const BETA_FLAG = "computer-use-2025-01-24";
const TOOL_VERSION = "computer_20250124";
const SS_DIR = "./screenshots";
const MAX_HISTORY_IMAGES = 3;   // Keep only last N screenshots in conversation
const MAX_RETRIES = 3;          // Retries on 429

// ── Anthropic API Call (with retry on 429) ──────────────────────────────

async function callClaude(messages, system) {
  const aiConfig = await fetchAIConfig();
  if (!aiConfig?.api_key) throw new Error("No Anthropic API key available");

  const body = {
    model: MODEL,
    max_tokens: 4096,
    system,
    tools: [
      {
        type: TOOL_VERSION,
        name: "computer",
        display_width_px: VIEWPORT.width,
        display_height_px: VIEWPORT.height,
        display_number: 1,
      }
    ],
    messages,
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": aiConfig.api_key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": BETA_FLAG,
      },
      body: JSON.stringify(body),
    });

    if (r.ok) return await r.json();

    const err = await r.json().catch(() => ({}));
    const msg = err.error?.message || `status ${r.status}`;

    // Retry on 429 with exponential backoff
    if (r.status === 429 && attempt < MAX_RETRIES) {
      const wait = Math.min(attempt * 15, 60);  // 15s, 30s, 60s
      console.warn(`[CU] Rate limited (429). Waiting ${wait}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
      await new Promise(res => setTimeout(res, wait * 1000));
      continue;
    }

    throw new Error(`Claude API ${r.status}: ${msg}`);
  }
}

// ── Viewport-only screenshot ────────────────────────────────────────────

async function takeScreenshot(page, label) {
  try {
    await mkdir(SS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filepath = path.join(SS_DIR, `${label}_${ts}.png`);
    await page.screenshot({ path: filepath, fullPage: false });
    console.log(`[CU] Screenshot: ${filepath}`);
    const buf = await readFile(filepath);
    return buf.toString("base64");
  } catch (e) {
    console.error("[CU] Screenshot failed:", e.message);
    return null;
  }
}

// ── Conversation history management ─────────────────────────────────────
// Replace old screenshot images with text placeholders to stay under
// token limits. Keeps only the last MAX_HISTORY_IMAGES screenshots.

function trimHistory(messages) {
  // Count image blocks from the end, replace older ones with text
  let imageCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg.content || !Array.isArray(msg.content)) continue;

    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j];

      // tool_result with image inside
      if (block.type === "tool_result" && Array.isArray(block.content)) {
        for (let k = block.content.length - 1; k >= 0; k--) {
          if (block.content[k].type === "image") {
            imageCount++;
            if (imageCount > MAX_HISTORY_IMAGES) {
              block.content[k] = { type: "text", text: "[previous screenshot — omitted to save tokens]" };
            }
          }
        }
      }

      // Direct image block in user message
      if (block.type === "image") {
        imageCount++;
        if (imageCount > MAX_HISTORY_IMAGES) {
          msg.content[j] = { type: "text", text: "[previous screenshot — omitted to save tokens]" };
        }
      }
    }
  }
  return messages;
}

// ── Execute a Computer Use action via Playwright ────────────────────────

async function executeComputerAction(page, input) {
  const { action, coordinate, text, start_coordinate, end_coordinate } = input;

  switch (action) {
    case "screenshot":
      return "screenshot_requested";

    case "left_click":
      if (coordinate) {
        await page.mouse.click(coordinate[0], coordinate[1], { button: "left" });
        console.log(`[CU] left_click (${coordinate[0]}, ${coordinate[1]})`);
      }
      return "ok";

    case "right_click":
      if (coordinate) {
        await page.mouse.click(coordinate[0], coordinate[1], { button: "right" });
        console.log(`[CU] right_click (${coordinate[0]}, ${coordinate[1]})`);
      }
      return "ok";

    case "double_click":
      if (coordinate) {
        await page.mouse.dblclick(coordinate[0], coordinate[1]);
        console.log(`[CU] double_click (${coordinate[0]}, ${coordinate[1]})`);
      }
      return "ok";

    case "triple_click":
      if (coordinate) {
        await page.mouse.click(coordinate[0], coordinate[1], { clickCount: 3 });
        console.log(`[CU] triple_click (${coordinate[0]}, ${coordinate[1]})`);
      }
      return "ok";

    case "middle_click":
      if (coordinate) {
        await page.mouse.click(coordinate[0], coordinate[1], { button: "middle" });
        console.log(`[CU] middle_click (${coordinate[0]}, ${coordinate[1]})`);
      }
      return "ok";

    case "mouse_move":
      if (coordinate) {
        await page.mouse.move(coordinate[0], coordinate[1]);
        console.log(`[CU] mouse_move (${coordinate[0]}, ${coordinate[1]})`);
      }
      return "ok";

    case "left_click_drag":
      if (start_coordinate && end_coordinate) {
        await page.mouse.move(start_coordinate[0], start_coordinate[1]);
        await page.mouse.down();
        await page.mouse.move(end_coordinate[0], end_coordinate[1]);
        await page.mouse.up();
        console.log(`[CU] drag (${start_coordinate}) → (${end_coordinate})`);
      }
      return "ok";

    case "type":
      if (text) {
        await page.keyboard.type(text, { delay: 20 });
        console.log(`[CU] type "${text.slice(0, 40)}${text.length > 40 ? "..." : ""}"`);
      }
      return "ok";

    case "key": {
      const keyStr = text || "";
      const keys = keyStr.split("+").map(k => mapKey(k.trim()));
      if (keys.length === 1) {
        await page.keyboard.press(keys[0]);
      } else {
        for (let i = 0; i < keys.length - 1; i++) await page.keyboard.down(keys[i]);
        await page.keyboard.press(keys[keys.length - 1]);
        for (let i = keys.length - 2; i >= 0; i--) await page.keyboard.up(keys[i]);
      }
      console.log(`[CU] key "${keyStr}"`);
      return "ok";
    }

    case "hold_key": {
      const holdKey = mapKey(input.key || "");
      await page.keyboard.down(holdKey);
      if (coordinate) await page.mouse.click(coordinate[0], coordinate[1]);
      await page.keyboard.up(holdKey);
      console.log(`[CU] hold_key "${input.key}" + click (${coordinate})`);
      return "ok";
    }

    case "scroll":
      if (coordinate) await page.mouse.move(coordinate[0], coordinate[1]);
      const dir = input.direction || "down";
      const amt = input.amount || 3;
      const px = amt * 120;
      const deltaX = dir === "left" ? -px : dir === "right" ? px : 0;
      const deltaY = dir === "up" ? -px : dir === "down" ? px : 0;
      await page.mouse.wheel(deltaX, deltaY);
      console.log(`[CU] scroll ${dir} ×${amt} at (${coordinate || "current"})`);
      return "ok";

    case "wait":
      const secs = input.duration || input.seconds || 2;
      await page.waitForTimeout(secs * 1000);
      console.log(`[CU] wait ${secs}s`);
      return "ok";

    case "cursor_position":
      console.log("[CU] cursor_position (returning 0,0)");
      return "ok";

    default:
      console.warn(`[CU] Unknown action: ${action}`);
      return "unknown";
  }
}

/** Map Claude's key names to Playwright key names. */
function mapKey(key) {
  const map = {
    "return": "Enter", "enter": "Enter", "space": " ", "tab": "Tab",
    "backspace": "Backspace", "delete": "Delete",
    "escape": "Escape", "esc": "Escape",
    "up": "ArrowUp", "down": "ArrowDown",
    "left": "ArrowLeft", "right": "ArrowRight",
    "home": "Home", "end": "End",
    "page_up": "PageUp", "pageup": "PageUp",
    "page_down": "PageDown", "pagedown": "PageDown",
    "ctrl": "Control", "control": "Control",
    "alt": "Alt", "shift": "Shift",
    "super": "Meta", "meta": "Meta", "cmd": "Meta", "command": "Meta",
    "f1": "F1", "f2": "F2", "f3": "F3", "f4": "F4", "f5": "F5",
    "f6": "F6", "f7": "F7", "f8": "F8", "f9": "F9", "f10": "F10",
    "f11": "F11", "f12": "F12",
  };
  return map[key.toLowerCase()] || key;
}

// ── Main Agent Loop ─────────────────────────────────────────────────────

export async function aiResolve(page, taskContext, options = {}) {
  const maxIterations = options.maxAttempts || MAX_ITERATIONS;
  const creds = options.credentials || {};

  console.log(`\n[CU] ━━━ Computer Use Agent v4.1 (${MODEL}) ━━━`);
  console.log(`[CU] Task: ${taskContext.slice(0, 100)}`);
  console.log(`[CU] Viewport: ${VIEWPORT.width}×${VIEWPORT.height}`);

  // Resize page viewport to match declared Computer Use viewport
  // This ensures screenshot coordinates match the declared dimensions
  const origViewport = page.viewportSize();
  await page.setViewportSize(VIEWPORT);
  console.log(`[CU] Page viewport resized to ${VIEWPORT.width}×${VIEWPORT.height}`);

  const system = `You are an expert browser automation agent controlling a ` +
    `${VIEWPORT.width}×${VIEWPORT.height} desktop. You are automating SAP applications ` +
    `(S/4HANA Cloud, Cloud ALM, CBC) which use UI5 Web Components with shadow DOM.

Key SAP UI patterns:
- UI5 Web Components: ui5-button, ui5-dialog, ui5-input, ui5-select, ui5-table
- Fiori shell header at top, navigation on the left
- CBC (Central Business Configuration) uses a workspace/catalog model
- Dialogs often overlay main content — close them before proceeding
- Loading indicators (spinners, busy bars) mean wait before clicking
- Dropdown/select options appear in popover overlays

Rules:
- Take a screenshot first if you need to see the current state
- Wait 1-2 seconds after clicking before taking the next screenshot
- If a click didn't work (same screen), try different coordinate or alternative path
- When task is complete, respond with a text message saying what you accomplished
- If stuck after several attempts, respond with text explaining what went wrong`;

  // Take initial screenshot
  const img = await takeScreenshot(page, "cu-start");
  if (!img) {
    console.error("[CU] Failed to take initial screenshot");
    if (origViewport) await page.setViewportSize(origViewport);
    return false;
  }

  let credInfo = "";
  if (creds.username) credInfo = `\n[System credentials: ${creds.username}]`;

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${taskContext}${credInfo}\n\nHere is the current screen. Proceed with the task.`
        },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: img }
        }
      ]
    }
  ];

  // ── Agent loop ──
  try {
    for (let iter = 1; iter <= maxIterations; iter++) {
      console.log(`[CU] ── Iteration ${iter}/${maxIterations} ──`);

      // Trim old screenshots before each API call
      trimHistory(messages);

      let response;
      try {
        response = await callClaude(messages, system);
      } catch (err) {
        console.error(`[CU] API error: ${err.message}`);
        return false;
      }

      const stopReason = response.stop_reason;
      const content = response.content || [];
      messages.push({ role: "assistant", content });

      // Check if Claude is done
      const hasToolUse = content.some(b => b.type === "tool_use");
      if (stopReason === "end_turn" && !hasToolUse) {
        const textMsg = content.filter(b => b.type === "text").map(b => b.text).join("\n");
        console.log(`[CU] Claude says: ${textMsg.slice(0, 200)}`);
        console.log("[CU] ━━━ Task complete ━━━\n");
        return true;
      }

      const toolUseBlocks = content.filter(b => b.type === "tool_use");
      if (toolUseBlocks.length === 0) {
        const text = content.filter(b => b.type === "text").map(b => b.text).join(" ").toLowerCase();
        if (text.includes("complete") || text.includes("done") || text.includes("finished")) {
          console.log("[CU] ━━━ Task complete (inferred) ━━━\n");
          return true;
        }
        console.log(`[CU] No tool_use, stop=${stopReason} — stopping`);
        return false;
      }

      // Execute each tool_use and collect results
      const toolResults = [];
      for (const block of toolUseBlocks) {
        const { id: toolId, name: toolName, input: toolInput } = block;

        if (toolName !== "computer") {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolId,
            content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
            is_error: true,
          });
          continue;
        }

        let result;
        try {
          result = await executeComputerAction(page, toolInput);
        } catch (err) {
          console.error(`[CU] Action failed: ${err.message}`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolId,
            content: [{ type: "text", text: `Error: ${err.message}` }],
            is_error: true,
          });
          continue;
        }

        // Wait for UI to settle after non-screenshot actions
        if (result !== "screenshot_requested") {
          await page.waitForTimeout(1200);
        }

        const ssBase64 = await takeScreenshot(page, `cu-${iter}`);
        if (ssBase64) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolId,
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: ssBase64 } }
            ],
          });
        } else {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolId,
            content: [{ type: "text", text: "Screenshot failed" }],
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    console.warn("[CU] ━━━ Max iterations reached ━━━\n");
    return false;

  } finally {
    // Restore original viewport
    if (origViewport) {
      await page.setViewportSize(origViewport).catch(() => {});
      console.log(`[CU] Viewport restored to ${origViewport.width}×${origViewport.height}`);
    }
  }
}

// ── Convenience Wrappers (unchanged interface) ──────────────────────────

export async function withAIFallback(page, action, taskContext, options = {}) {
  try {
    return await action();
  } catch (err) {
    console.warn(`[CU] Fallback triggered: ${err.message}`);
    const ok = await aiResolve(
      page,
      taskContext + ` (Error encountered: ${err.message})`,
      options
    );
    if (!ok) throw new Error(`Computer Use agent could not resolve: ${taskContext}`);
    try { return await action(); } catch { return null; }
  }
}

export async function tryLearnedStrategies() {
  return false;
}
