// DealFlow AI Runner — Computer Use Agent
// Uses Anthropic's Computer Use API (computer_20250124) for pixel-based browser control.
// When Playwright encounters an unexpected state, this agent:
// 1. Takes a screenshot
// 2. Sends it to Claude with the computer tool
// 3. Claude returns coordinate-based actions (click at x,y / type / key press)
// 4. Executes via Playwright mouse/keyboard at exact pixel coordinates
// 5. Loops until Claude sends a text response (task complete)

import { readFile } from 'fs/promises';
import { screenshot } from './browser.js';
import { fetchAIConfig } from './api.js';
import { learnFromSuccess, tryLearnedStrategies } from './learned-strategies.js';
export { tryLearnedStrategies };

const MAX_TURNS = 20;
const VIEWPORT = { width: 1024, height: 768 };

/**
 * Take a viewport-only screenshot at CSS (1x) resolution for Computer Use coordinate accuracy.
 * On Retina Macs, Playwright takes 2x screenshots by default — this forces 1:1 pixel mapping.
 */
async function captureScreen(page, label) {
  try {
    const { mkdir } = await import('fs/promises');
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${label}_${ts}.png`;
    const dir = './screenshots';
    await mkdir(dir, { recursive: true });
    const filepath = `${dir}/${filename}`;
    // CRITICAL: scale:'css' forces 1x resolution so pixel coords match the declared display size
    await page.screenshot({ path: filepath, fullPage: false, scale: 'css' });
    console.log(`[CU Agent] Screenshot: ${filepath}`);
    const buf = await readFile(filepath);
    return buf.toString('base64');
  } catch (e) {
    console.error("[CU Agent] Screenshot failed:", e.message);
    return null;
  }
}

/**
 * Flash a red dot at the click coordinates, accounting for CSS zoom.
 */
async function showClickIndicator(page, x, y) {
  await page.evaluate(({x, y}) => {
    const zoom = parseFloat(document.body.style.zoom) || 1;
    const cx = x / zoom;
    const cy = y / zoom;
    const dot = document.createElement('div');
    dot.style.cssText = `position:fixed;left:${cx-12}px;top:${cy-12}px;width:24px;height:24px;border-radius:50%;background:rgba(255,0,0,0.6);border:3px solid red;z-index:999999;pointer-events:none;transition:opacity 0.8s;`;
    document.body.appendChild(dot);
    setTimeout(() => { dot.style.opacity = '0'; }, 200);
    setTimeout(() => dot.remove(), 1000);
  }, {x, y}).catch(() => {});
}

/**
 * Get or create a CDP session for raw input injection.
 * CDP Input.dispatchMouseEvent bypasses DOM overlay interception entirely.
 */
let _cdpSession = null;
async function getCDP(page) {
  if (!_cdpSession) {
    try {
      _cdpSession = await page.context().newCDPSession(page);
    } catch (e) {
      // Fallback — context may not support CDP (shouldn't happen with Chromium)
      console.warn('[CU Agent] CDP session failed:', e.message);
      return null;
    }
  }
  return _cdpSession;
}

// Reset CDP session (call on page navigation)
function resetCDP() { _cdpSession = null; }

/**
 * CDP mouse click — bypasses UI5 dialog overlay interception.
 * Falls back to Playwright if CDP unavailable.
 */
async function cdpClick(page, x, y, opts = {}) {
  const cdp = await getCDP(page);
  const button = opts.button || 'left';
  const clickCount = opts.clickCount || 1;
  if (cdp) {
    try {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount });
      return;
    } catch (e) {
      console.warn('[CU Agent] CDP click failed, falling back to Playwright:', e.message);
      resetCDP();
    }
  }
  // Fallback
  await page.mouse.click(x, y, { button, clickCount });
}

/**
 * CDP mouse move. Falls back to Playwright.
 */
async function cdpMove(page, x, y) {
  const cdp = await getCDP(page);
  if (cdp) {
    try { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); return; }
    catch { resetCDP(); }
  }
  await page.mouse.move(x, y);
}

/**
 * Execute a single computer use action via CDP (mouse) + Playwright (keyboard).
 */
async function executeAction(page, input) {
  const { action, coordinate, text } = input;

  switch (action) {
    case 'screenshot':
      return;

    case 'left_click':
      if (coordinate) {
        console.log(`[CU Agent] Click at (${coordinate[0]}, ${coordinate[1]})`);
        await showClickIndicator(page, coordinate[0], coordinate[1]);
        await cdpClick(page, coordinate[0], coordinate[1]);
        await page.waitForTimeout(800);
      }
      return;

    case 'right_click':
      if (coordinate) {
        console.log(`[CU Agent] Right-click at (${coordinate[0]}, ${coordinate[1]})`);
        await showClickIndicator(page, coordinate[0], coordinate[1]);
        await cdpClick(page, coordinate[0], coordinate[1], { button: 'right' });
        await page.waitForTimeout(500);
      }
      return;

    case 'double_click':
      if (coordinate) {
        console.log(`[CU Agent] Double-click at (${coordinate[0]}, ${coordinate[1]})`);
        await showClickIndicator(page, coordinate[0], coordinate[1]);
        await cdpClick(page, coordinate[0], coordinate[1], { clickCount: 2 });
        await page.waitForTimeout(500);
      }
      return;

    case 'triple_click':
      if (coordinate) {
        console.log(`[CU Agent] Triple-click at (${coordinate[0]}, ${coordinate[1]})`);
        await showClickIndicator(page, coordinate[0], coordinate[1]);
        await cdpClick(page, coordinate[0], coordinate[1], { clickCount: 3 });
        await page.waitForTimeout(500);
      }
      return;

    case 'mouse_move':
      if (coordinate) {
        await cdpMove(page, coordinate[0], coordinate[1]);
      }
      return;

    case 'left_mouse_down':
      if (coordinate) {
        const cdp = await getCDP(page);
        if (cdp) await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coordinate[0], y: coordinate[1], button: 'left', clickCount: 1 });
        else await page.mouse.down();
      }
      return;

    case 'left_mouse_up':
      if (coordinate) {
        const cdp = await getCDP(page);
        if (cdp) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coordinate[0], y: coordinate[1], button: 'left', clickCount: 1 });
        else await page.mouse.up();
      }
      return;

    case 'left_click_drag':
      if (input.start_coordinate && coordinate) {
        const [sx, sy] = input.start_coordinate;
        const [ex, ey] = coordinate;
        const cdp = await getCDP(page);
        if (cdp) {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ex, y: ey });
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'left', clickCount: 1 });
        } else {
          await page.mouse.move(sx, sy); await page.mouse.down();
          await page.mouse.move(ex, ey); await page.mouse.up();
        }
        console.log(`[CU Agent] Drag (${sx},${sy}) → (${ex},${ey})`);
        await page.waitForTimeout(500);
      }
      return;

    case 'type':
      if (text) {
        console.log(`[CU Agent] Typing: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
        await page.keyboard.type(text, { delay: 30 });
        await page.waitForTimeout(300);
      }
      return;

    case 'key':
      if (text) {
        // Map common key names to Playwright format
        const keyMap = {
          'Return': 'Enter', 'enter': 'Enter',
          'space': ' ', 'Space': ' ',
          'BackSpace': 'Backspace', 'backspace': 'Backspace',
          'Escape': 'Escape', 'escape': 'Escape',
          'Tab': 'Tab', 'tab': 'Tab',
          'Delete': 'Delete', 'delete': 'Delete',
          'Home': 'Home', 'End': 'End',
          'Page_Up': 'PageUp', 'Page_Down': 'PageDown',
          'Up': 'ArrowUp', 'Down': 'ArrowDown',
          'Left': 'ArrowLeft', 'Right': 'ArrowRight',
          'F5': 'F5',
        };
        // Handle combo keys like "ctrl+a"
        const parts = text.split('+').map(k => k.trim());
        if (parts.length > 1) {
          const modifiers = parts.slice(0, -1);
          const key = keyMap[parts[parts.length - 1]] || parts[parts.length - 1];
          const modMap = { 'ctrl': 'Control', 'alt': 'Alt', 'shift': 'Shift', 'meta': 'Meta', 'super': 'Meta' };
          for (const m of modifiers) await page.keyboard.down(modMap[m.toLowerCase()] || m);
          await page.keyboard.press(key);
          for (const m of modifiers.reverse()) await page.keyboard.up(modMap[m.toLowerCase()] || m);
        } else {
          const key = keyMap[text] || text;
          await page.keyboard.press(key);
        }
        console.log(`[CU Agent] Key: ${text}`);
        await page.waitForTimeout(300);
      }
      return;

    case 'scroll':
      if (coordinate) {
        const cdp = await getCDP(page);
        const deltaY = (input.scroll_direction === 'up' ? -300 : 300);
        await cdpMove(page, coordinate[0], coordinate[1]);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: coordinate[0], y: coordinate[1], deltaX: 0, deltaY
        });
        console.log(`[CU Agent] Scroll ${input.scroll_direction || 'down'} at (${coordinate[0]}, ${coordinate[1]})`);
        await page.waitForTimeout(500);
      }
      return;

    case 'wait':
      console.log(`[CU Agent] Waiting...`);
      await page.waitForTimeout(3000);
      return;

    case 'drag':
      if (input.start_coordinate && input.end_coordinate) {
        const cdp = await getCDP(page);
        const [sx, sy] = input.start_coordinate;
        const [ex, ey] = input.end_coordinate;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ex, y: ey });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'left', clickCount: 1 });
        console.log(`[CU Agent] Drag (${sx},${sy}) → (${ex},${ey})`);
        await page.waitForTimeout(500);
      }
      return;

    default:
      console.warn(`[CU Agent] Unknown action: ${action}`);
  }
}

/**
 * Main entry point — uses Computer Use API to resolve a stuck state.
 * Loops: screenshot → Claude decides action → execute → screenshot → repeat
 * until Claude sends a text-only response (task complete) or max turns.
 *
 * @param {Page} page - Playwright page
 * @param {string} taskContext - What we're trying to do
 * @param {object} options - { maxAttempts, credentials, taskType, learnContext }
 * @returns {boolean} - true if resolved
 */
export async function aiResolve(page, taskContext, options = {}) {
  const maxTurns = options.maxAttempts || MAX_TURNS;
  const credentials = options.credentials || {};
  const taskType = options.taskType || null;

  // API key priority: options > env var > aiConfig (if it looks like a real Anthropic key)
  let apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const aiConfig = await fetchAIConfig();
    apiKey = aiConfig?.api_key?.startsWith('sk-ant-') ? aiConfig.api_key : null;
  }
  if (!apiKey) throw new Error("No Anthropic API key — configure it in System Connections → Anthropic Computer Use, or set ANTHROPIC_API_KEY env var");

  const model = options.model || "claude-sonnet-4-20250514";
  console.log(`\n[CU Agent] ━━━ Computer Use Agent ━━━`);
  console.log(`[CU Agent] Model: ${model}`);
  console.log(`[CU Agent] Task: ${taskContext}`);

  // Take initial screenshot
  const initialB64 = await captureScreen(page, 'cu-start');
  if (!initialB64) { console.error("[CU Agent] Failed to capture screen"); return false; }

  let credentialNote = '';
  if (credentials.username) credentialNote = `\nLogin credentials if needed: username="${credentials.username}", password is available.`;

  // Build conversation with Computer Use tool
  const messages = [{
    role: "user",
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: initialB64 }
      },
      {
        type: "text",
        text: `${taskContext}${credentialNote}\n\nHere is the current state of the browser. Complete the task using the computer tool. When the task is complete, respond with a text message describing what was accomplished.`
      }
    ]
  }];

  const tools = [{
    type: "computer_20250124",
    name: "computer",
    display_width_px: VIEWPORT.width,
    display_height_px: VIEWPORT.height,
  }];

  const actionHistory = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    console.log(`[CU Agent] Turn ${turn + 1}/${maxTurns}`);

    // Trim conversation to avoid rate limits — keep first message + last 3 turn pairs
    // Each "turn pair" = 1 assistant message + 1 user (tool_result) message
    const MAX_HISTORY_PAIRS = 2;
    let trimmedMessages = messages;
    if (messages.length > 1 + MAX_HISTORY_PAIRS * 2) {
      trimmedMessages = [messages[0], ...messages.slice(-(MAX_HISTORY_PAIRS * 2))];
      console.log(`[CU Agent] Trimmed history: ${messages.length} → ${trimmedMessages.length} messages`);
    }

    // Rate limit: wait if we're going fast
    if (turn > 0) await new Promise(r => setTimeout(r, 2000));

    // Call Claude API
    let data;
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "computer-use-2025-01-24",
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 8192,
          thinking: {
            type: "enabled",
            budget_tokens: 1024
          },
          system: "You are a browser automation agent controlling a Playwright browser to complete tasks in SAP systems. Use the computer tool to interact with the browser by clicking, typing, scrolling and taking screenshots.\n\nIMPORTANT: After each action, take a screenshot and carefully evaluate if you have achieved the right outcome. Explicitly show your thinking: \"I have evaluated step X...\" If not correct, try again. Only when you confirm a step was executed correctly should you move on to the next one.\n\nFor dropdowns and UI5 components, prefer keyboard shortcuts (Tab, Space, Arrow keys, Enter) over mouse clicks when direct clicks don't work.\n\nWhen the task is complete, respond with a text message describing what was accomplished.",
          tools,
          messages: trimmedMessages,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const errMsg = err.error?.message || `Status ${r.status}`;
        if (r.status === 429) {
          console.warn(`[CU Agent] Rate limited — waiting 30s before retry...`);
          await new Promise(r => setTimeout(r, 30000));
          turn--; // retry this turn
          continue;
        }
        console.error("[CU Agent] API error:", errMsg);
        return false;
      }
      data = await r.json();
    } catch (err) {
      console.error("[CU Agent] API call failed:", err.message);
      return false;
    }

    // Log thinking blocks for debugging
    const thinkingBlocks = data.content?.filter(b => b.type === 'thinking') || [];
    if (thinkingBlocks.length > 0) {
      for (const t of thinkingBlocks) {
        console.log(`[CU Agent] 💭 ${t.thinking?.slice(0, 200) || '(thinking)'}${t.thinking?.length > 200 ? '...' : ''}`);
      }
    }

    // Check if Claude responded with text only (task complete) or end_turn with no tool use
    const hasToolUse = data.content?.some(b => b.type === 'tool_use');
    const textBlocks = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';

    if (!hasToolUse) {
      console.log(`[CU Agent] ━━━ Task complete ━━━`);
      console.log(`[CU Agent] Result: ${textBlocks.slice(0, 200)}`);
      if (taskType) {
        await learnFromSuccess(taskType, taskContext, actionHistory, textBlocks, {}).catch(() => {});
      }
      return true;
    }

    // Add assistant response to conversation
    messages.push({ role: "assistant", content: data.content });

    // Process each tool_use block
    const toolResults = [];
    for (const block of data.content) {
      if (block.type !== 'tool_use') continue;

      const { id, input } = block;
      actionHistory.push({ turn: turn + 1, action: input.action, coordinate: input.coordinate, text: input.text });

      // Inject credentials for password typing
      if (input.action === 'type' && credentials.password) {
        const pageText = await page.evaluate(() => {
          const active = document.activeElement;
          return active?.type || active?.tagName || '';
        }).catch(() => '');
        if (pageText === 'password') input.text = credentials.password;
      }

      // Execute the action
      try {
        await executeAction(page, input);
      } catch (err) {
        console.warn(`[CU Agent] Action failed: ${err.message}`);
      }

      // Take screenshot after action for the tool result
      await page.waitForTimeout(500);
      const screenshotB64 = await captureScreen(page, `cu-turn-${turn + 1}`);

      toolResults.push({
        type: "tool_result",
        tool_use_id: id,
        content: screenshotB64 ? [
          { type: "image", source: { type: "base64", media_type: "image/png", data: screenshotB64 } }
        ] : [
          { type: "text", text: "Screenshot capture failed" }
        ],
      });
    }

    // Add tool results to conversation
    messages.push({ role: "user", content: toolResults });
  }

  console.warn(`[CU Agent] ━━━ Max turns (${maxTurns}) reached ━━━`);
  console.warn(`[CU Agent] Actions: ${JSON.stringify(actionHistory.map(a => `${a.action}${a.coordinate ? `@${a.coordinate}` : ''}`))}`);
  return false;
}

/**
 * Wrapper — tries an action, falls back to Computer Use agent if it fails.
 */
export async function withAIFallback(page, action, taskContext, options = {}) {
  try {
    return await action();
  } catch (err) {
    console.warn(`[CU Agent] Action failed: ${err.message} — engaging Computer Use agent...`);
    const resolved = await aiResolve(page, taskContext + ` (Error: ${err.message})`, options);
    if (!resolved) throw new Error(`Computer Use agent could not resolve: ${taskContext}`);
    try { return await action(); } catch { return null; }
  }
}
