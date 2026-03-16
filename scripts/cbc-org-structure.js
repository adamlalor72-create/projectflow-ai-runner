// ProjectFlow AI Runner — CBC Org Structure Creation
// Creates organizational structure in SAP CBC using discovered element IDs.
// Based on Computer Use discovery recording: recordings/cbc-org-structure-discovery.json
//
// Org structure creation order (respects parent-child dependencies):
// 1. Company Code (top-level)
// 2. Plant (under Company Code)
// 3. Storage Location(s) (under Plant)
// 4. Sales Organization (under Company Code)
// 5. Distribution Channel (top-level)
// 6. Division (top-level)
// 7. Sales Area (under Sales Org, picks DCH + DIV)
// 8. Purchasing Organization (top-level)
// 9. Sales Office (top-level)
// 10. Shipping Point(s) (top-level)
// 11. Complete Activity

import { screenshot } from '../lib/browser.js';

// ── Element IDs (stable across CBC versions) ────────────────────────────
const EL = {
  ID:       'entity-id',
  NAME:     'entity-name',
  CITY:     'entity-city',
  COUNTRY:  'country-region',
  SUBTYPE:  'sub-type',
  COMPANY:  'select-company',
  COMP_CODE:'company-code',
  DCH:      'distributionChannel',
  DIV:      'division',
};

// ── Default UK GROW Fast Org Structure ──────────────────────────────────
// Used when no org_units source data is provided.
const DEFAULT_ORG = {
  country: "GB",
  company_code: { id: "1000", name: "UK Company Code", city: "London" },
  plant:        { id: "1000", name: "UK Plant", city: "London" },
  storage_locations: [
    { id: "100A", name: "Finished Goods", city: "London", subtype: "STL_STD_A" },
    { id: "100B", name: "Raw Materials", city: "London", subtype: "STL_RAW_MATNR" },
  ],
  sales_org:    { id: "1000", name: "UK Sales Org", city: "London" },
  dist_channel: { id: "10", name: "Direct Sales" },
  division:     { id: "00", name: "Cross-Division" },
  sales_area:   { name: "UK Sales Area" },
  purch_org:    { id: "1000", name: "UK Purchasing Org" },
  sales_office: { id: "100", name: "UK Sales Office", city: "London" },
  shipping_points: [
    { id: "1000", name: "UK Shipping Standard", city: "London", subtype: "SPT_STD" },
    { id: "100R", name: "UK Shipping Returns", city: "London", subtype: "SPT_RAW_MATNR" },
  ],
};

// ── Shadow DOM helpers ──────────────────────────────────────────────────
// CBC uses UI5 Web Components with shadow DOM. Standard querySelector
// won't find elements inside shadow roots. These helpers traverse them.

async function setInputValue(page, elementId, value) {
  // Click the input to focus it, clear, then type
  await page.evaluate((id) => {
    const el = document.querySelector(`[id="${id}"], [id$="${id}"]`);
    if (!el) return false;
    // UI5 inputs: get the inner native input via shadow DOM
    const inner = el.shadowRoot?.querySelector('input') || el;
    inner.focus();
    inner.value = '';
    inner.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, elementId);
  await page.waitForTimeout(200);
  // Use Playwright keyboard for reliable typing
  const input = page.locator(`#${elementId}`).first();
  if (await input.count() > 0) {
    await input.click({ timeout: 5000 });
    await page.keyboard.press('Meta+a');
    await page.keyboard.type(value, { delay: 30 });
    console.log(`[OrgStr] Set #${elementId} = "${value}"`);
  } else {
    // Fallback: try broader selector
    const alt = page.locator(`[id$="${elementId}"]`).first();
    if (await alt.count() > 0) {
      await alt.click({ timeout: 5000 });
      await page.keyboard.press('Meta+a');
      await page.keyboard.type(value, { delay: 30 });
      console.log(`[OrgStr] Set [id$=${elementId}] = "${value}"`);
    } else {
      console.warn(`[OrgStr] Input not found: ${elementId}`);
    }
  }
}

async function selectValue(page, elementId, valueOrText) {
  // For ui5-select elements: click to open, then pick option
  const sel = page.locator(`#${elementId}, [id$="${elementId}"]`).first();
  if (await sel.count() === 0) {
    console.warn(`[OrgStr] Select not found: ${elementId}`);
    return;
  }
  await sel.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  // Try to find the option by text or value
  const opt = page.locator(`ui5-option:has-text("${valueOrText}"), ui5-li:has-text("${valueOrText}")`).first();
  if (await opt.isVisible({ timeout: 3000 }).catch(() => false)) {
    await opt.click({ timeout: 5000 });
    console.log(`[OrgStr] Selected "${valueOrText}" in #${elementId}`);
  } else {
    console.warn(`[OrgStr] Option "${valueOrText}" not found in #${elementId}`);
  }
  await page.waitForTimeout(300);
}

async function clickButton(page, text, opts = {}) {
  // Click a ui5-button by text. opts.design for specificity (e.g. 'Emphasized')
  const designSel = opts.design ? `[design="${opts.design}"]` : '';
  const selectors = [
    `ui5-button${designSel}:has-text("${text}")`,
    `button:has-text("${text}")`,
    `[role="button"]:has-text("${text}")`,
  ];
  for (const sel of selectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click({ timeout: 10000 });
      console.log(`[OrgStr] Clicked button: "${text}"`);
      return true;
    }
  }
  console.warn(`[OrgStr] Button not found: "${text}"`);
  return false;
}

async function clickByDataAction(page, actionName) {
  // Click element by data-action-name attribute (CBC-specific)
  const el = page.locator(`[data-action-name="${actionName}"]`).first();
  if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
    await el.click({ timeout: 10000 });
    console.log(`[OrgStr] Clicked [data-action-name="${actionName}"]`);
    return true;
  }
  console.warn(`[OrgStr] data-action-name="${actionName}" not found`);
  return false;
}

async function clickInlineCreateLink(page, linkText) {
  // Click the "+ Create X" inline link in the org table tree
  // These are typically spans or links inside tree table rows
  const selectors = [
    `span:has-text("${linkText}")`,
    `a:has-text("${linkText}")`,
    `*:has-text("${linkText}")`,
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      await el.click({ timeout: 10000 });
      console.log(`[OrgStr] Clicked inline link: "${linkText}"`);
      return true;
    }
  }
  console.warn(`[OrgStr] Inline link not found: "${linkText}"`);
  return false;
}

async function waitForSidePanel(page) {
  // Wait for the side panel to appear with entity-id input
  for (let i = 0; i < 10; i++) {
    const visible = await page.locator(`#${EL.ID}, [id$="${EL.ID}"]`).first()
      .isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) return true;
    await page.waitForTimeout(500);
  }
  console.warn('[OrgStr] Side panel did not appear');
  return false;
}

async function clickSidePanelCreate(page) {
  // The Create button in the side panel is always design="Emphasized"
  return await clickButton(page, 'Create', { design: 'Emphasized' });
}

// ── Org Unit Creation Functions ─────────────────────────────────────────

async function createViaGlobalMenu(page, actionName, fields) {
  // 1. Click global Create button
  const createBtn = page.locator('#createGlobalOrgUnit').first();
  if (await createBtn.count() > 0) {
    await createBtn.click({ timeout: 5000 });
    await page.waitForTimeout(500);
  }
  // 2. Click the specific type from dropdown
  await clickByDataAction(page, actionName);
  await page.waitForTimeout(1000);
  // 3. Wait for side panel
  await waitForSidePanel(page);
  // 4. Fill fields
  await fillFields(page, fields);
  // 5. Click Create
  await clickSidePanelCreate(page);
  await page.waitForTimeout(2000);
}

async function createViaInlineLink(page, linkText, fields) {
  // 1. Click the inline "+ Create X" link in the table
  await clickInlineCreateLink(page, linkText);
  await page.waitForTimeout(1000);
  // 2. Wait for side panel
  await waitForSidePanel(page);
  // 3. Fill fields
  await fillFields(page, fields);
  // 4. Click Create
  await clickSidePanelCreate(page);
  await page.waitForTimeout(2000);
}

async function fillFields(page, fields) {
  // fields is an object like { id: 'value', name: 'value', city: 'value', country: 'GB', subtype: 'SPT_STD' }
  if (fields.id)      await setInputValue(page, EL.ID, fields.id);
  if (fields.name)    await setInputValue(page, EL.NAME, fields.name);
  if (fields.city)    await setInputValue(page, EL.CITY, fields.city);
  if (fields.country) await selectValue(page, EL.COUNTRY, fields.country);
  if (fields.subtype) await selectValue(page, EL.SUBTYPE, fields.subtype);
  if (fields.company) await selectValue(page, EL.COMPANY, fields.company);
  if (fields.company_code) await selectValue(page, EL.COMP_CODE, fields.company_code);
  if (fields.dist_channel) await selectValue(page, EL.DCH, fields.dist_channel);
  if (fields.division)     await selectValue(page, EL.DIV, fields.division);
}

// ── Country code to CBC country text mapping ────────────────────────────
function countryText(code) {
  const map = {
    'GB': 'GB', 'UK': 'GB', 'US': 'US', 'DE': 'DE', 'FR': 'FR',
    'AE': 'AE', 'SA': 'SA', 'IN': 'IN', 'AU': 'AU', 'CA': 'CA',
  };
  return map[code?.toUpperCase()] || code || 'GB';
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN: Create Org Structure
// ══════════════════════════════════════════════════════════════════════════

export async function createOrgStructure(page, orgData, options = {}) {
  const org = orgData || DEFAULT_ORG;
  const ctry = countryText(org.country);
  const results = { created: [], failed: [], skipped: [] };

  console.log(`\n[OrgStr] ═══ Creating Org Structure ═══`);
  console.log(`[OrgStr] Country: ${ctry}`);

  // ── Step 1: Navigate to Org Structure ──
  console.log('[OrgStr] Navigating to #/orgmanagement...');
  await page.evaluate(() => { window.location.hash = '/orgmanagement'; });
  await page.waitForTimeout(3000);
  await screenshot(page, 'orgstr-navigate');

  // ── Step 2: Switch to Table View ──
  console.log('[OrgStr] Switching to Table View...');
  await clickByDataAction(page, 'switchToTableView');
  await page.waitForTimeout(1500);
  await screenshot(page, 'orgstr-table-view');

  // ── Step 3: Company Code ──
  if (org.company_code) {
    const cc = org.company_code;
    console.log(`[OrgStr] Creating Company Code: ${cc.id} - ${cc.name}`);
    try {
      await createViaGlobalMenu(page, 'openSidePanelForCCDCreation', {
        id: cc.id, name: cc.name, city: cc.city || '', country: ctry,
      });
      await screenshot(page, 'orgstr-company-code');
      results.created.push({ type: 'Company Code', id: cc.id, name: cc.name });
    } catch (e) {
      console.error(`[OrgStr] Company Code failed: ${e.message}`);
      results.failed.push({ type: 'Company Code', id: cc.id, error: e.message });
    }
  }

  // ── Step 4: Plant (under Company Code) ──
  if (org.plant) {
    const p = org.plant;
    console.log(`[OrgStr] Creating Plant: ${p.id} - ${p.name}`);
    try {
      await createViaInlineLink(page, 'Create Plant', {
        id: p.id, name: p.name, city: p.city || '', country: ctry,
      });
      await screenshot(page, 'orgstr-plant');
      results.created.push({ type: 'Plant', id: p.id, name: p.name });
    } catch (e) {
      console.error(`[OrgStr] Plant failed: ${e.message}`);
      results.failed.push({ type: 'Plant', id: p.id, error: e.message });
    }
  }

  // ── Step 5: Storage Locations (under Plant) ──
  const slocs = org.storage_locations || [];
  for (const sl of slocs) {
    console.log(`[OrgStr] Creating Storage Location: ${sl.id} - ${sl.name}`);
    try {
      await createViaInlineLink(page, 'Create Storage Location', {
        id: sl.id, name: sl.name, city: sl.city || '', subtype: sl.subtype, country: ctry,
      });
      results.created.push({ type: 'Storage Location', id: sl.id, name: sl.name });
    } catch (e) {
      console.error(`[OrgStr] Storage Location failed: ${e.message}`);
      results.failed.push({ type: 'Storage Location', id: sl.id, error: e.message });
    }
  }
  if (slocs.length) await screenshot(page, 'orgstr-storage-locs');

  // ── Step 6: Sales Organization (under Company Code) ──
  if (org.sales_org) {
    const so = org.sales_org;
    console.log(`[OrgStr] Creating Sales Org: ${so.id} - ${so.name}`);
    try {
      await createViaInlineLink(page, 'Create Sales Organization', {
        id: so.id, name: so.name, city: so.city || '', country: ctry,
      });
      await screenshot(page, 'orgstr-sales-org');
      results.created.push({ type: 'Sales Organization', id: so.id, name: so.name });
    } catch (e) {
      console.error(`[OrgStr] Sales Org failed: ${e.message}`);
      results.failed.push({ type: 'Sales Organization', id: so.id, error: e.message });
    }
  }

  // ── Step 7: Distribution Channel (top-level) ──
  if (org.dist_channel) {
    const dc = org.dist_channel;
    console.log(`[OrgStr] Creating Distribution Channel: ${dc.id} - ${dc.name}`);
    try {
      await createViaGlobalMenu(page, 'openSidePanelForDCHCreation', {
        id: dc.id, name: dc.name,
      });
      results.created.push({ type: 'Distribution Channel', id: dc.id, name: dc.name });
    } catch (e) {
      console.error(`[OrgStr] Dist Channel failed: ${e.message}`);
      results.failed.push({ type: 'Distribution Channel', id: dc.id, error: e.message });
    }
  }

  // ── Step 8: Division (top-level) ──
  if (org.division) {
    const dv = org.division;
    console.log(`[OrgStr] Creating Division: ${dv.id} - ${dv.name}`);
    try {
      await createViaGlobalMenu(page, 'openSidePanelForDIVCreation', {
        id: dv.id, name: dv.name,
      });
      results.created.push({ type: 'Division', id: dv.id, name: dv.name });
    } catch (e) {
      console.error(`[OrgStr] Division failed: ${e.message}`);
      results.failed.push({ type: 'Division', id: dv.id, error: e.message });
    }
  }
  await screenshot(page, 'orgstr-dch-div');

  // ── Step 9: Sales Area (under Sales Org — composite unit) ──
  if (org.sales_area && org.sales_org && org.dist_channel && org.division) {
    const sa = org.sales_area;
    console.log(`[OrgStr] Creating Sales Area under Sales Org ${org.sales_org.id}`);
    try {
      await createViaInlineLink(page, 'Create Sales Area', {
        name: sa.name || 'Sales Area',
        dist_channel: org.dist_channel.id + ': ' + org.dist_channel.name,
        division: org.division.id + ': ' + org.division.name,
      });
      await screenshot(page, 'orgstr-sales-area');
      results.created.push({ type: 'Sales Area', name: sa.name });
    } catch (e) {
      console.error(`[OrgStr] Sales Area failed: ${e.message}`);
      results.failed.push({ type: 'Sales Area', error: e.message });
    }
  }

  // ── Step 10: Purchasing Organization (top-level) ──
  if (org.purch_org) {
    const po = org.purch_org;
    console.log(`[OrgStr] Creating Purchasing Org: ${po.id} - ${po.name}`);
    try {
      await createViaGlobalMenu(page, 'openSidePanelForPORCreation', {
        id: po.id, name: po.name,
        company_code: org.company_code ? org.company_code.id + ': ' + org.company_code.name : undefined,
      });
      results.created.push({ type: 'Purchasing Organization', id: po.id, name: po.name });
    } catch (e) {
      console.error(`[OrgStr] Purchasing Org failed: ${e.message}`);
      results.failed.push({ type: 'Purchasing Organization', id: po.id, error: e.message });
    }
  }

  // ── Step 11: Sales Office (top-level) ──
  if (org.sales_office) {
    const sf = org.sales_office;
    console.log(`[OrgStr] Creating Sales Office: ${sf.id} - ${sf.name}`);
    try {
      await createViaGlobalMenu(page, 'openSidePanelForSOFCreation', {
        id: sf.id, name: sf.name, city: sf.city || '', country: ctry,
      });
      results.created.push({ type: 'Sales Office', id: sf.id, name: sf.name });
    } catch (e) {
      console.error(`[OrgStr] Sales Office failed: ${e.message}`);
      results.failed.push({ type: 'Sales Office', id: sf.id, error: e.message });
    }
  }

  // ── Step 12: Shipping Points (top-level) ──
  const spts = org.shipping_points || [];
  for (const sp of spts) {
    console.log(`[OrgStr] Creating Shipping Point: ${sp.id} - ${sp.name}`);
    try {
      await createViaGlobalMenu(page, 'openSidePanelForSPT_GCreation', {
        id: sp.id, name: sp.name, city: sp.city || '', subtype: sp.subtype, country: ctry,
      });
      results.created.push({ type: 'Shipping Point', id: sp.id, name: sp.name });
    } catch (e) {
      console.error(`[OrgStr] Shipping Point failed: ${e.message}`);
      results.failed.push({ type: 'Shipping Point', id: sp.id, error: e.message });
    }
  }
  if (spts.length) await screenshot(page, 'orgstr-shipping-points');

  // ── Final screenshot ──
  await screenshot(page, 'orgstr-complete');

  console.log(`\n[OrgStr] ═══ Org Structure Summary ═══`);
  console.log(`[OrgStr] Created: ${results.created.length}`);
  console.log(`[OrgStr] Failed:  ${results.failed.length}`);
  if (results.failed.length > 0) {
    results.failed.forEach(f => console.log(`[OrgStr]   ✗ ${f.type} ${f.id || ''}: ${f.error}`));
  }

  return results;
}

// ══════════════════════════════════════════════════════════════════════════
// Playbook-compatible export
// Called from playbook-executor when playbook data_source = 'org_units'
// or when a step instruction contains [SCRIPT:cbc-org-structure]
// ══════════════════════════════════════════════════════════════════════════

export async function runCbcOrgStructure({ page, connection, sourceData, playbook }) {
  // sourceData can be:
  // 1. An org_units array with structured unit definitions
  // 2. A cbc_settings object with an org_structure field
  // 3. null/undefined → use DEFAULT_ORG

  let orgData = null;

  // Try to extract org structure from source data
  if (sourceData) {
    const src = Array.isArray(sourceData) ? sourceData[0] : sourceData;
    // If source has org_structure field (from CBC Settings config)
    if (src?.org_structure) {
      orgData = typeof src.org_structure === 'string'
        ? JSON.parse(src.org_structure) : src.org_structure;
    }
    // If source has config with org_structure
    if (!orgData && src?.config) {
      try {
        const cfg = typeof src.config === 'string' ? JSON.parse(src.config) : src.config;
        if (cfg.org_structure) orgData = cfg.org_structure;
      } catch {}
    }
    // If source itself looks like an org structure (has company_code field)
    if (!orgData && src?.company_code) orgData = src;
  }

  if (!orgData) {
    console.log('[OrgStr] No org data in source — using default UK GROW Fast structure');
    orgData = DEFAULT_ORG;
  }

  return await createOrgStructure(page, orgData);
}
