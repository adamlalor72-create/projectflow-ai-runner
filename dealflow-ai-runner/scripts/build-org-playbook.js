// CBC Org Structure Playbook — Step Builder
// Creates all playbook steps with JS sub-steps via the BTP API
// Run: DEALFLOW_RUNNER_KEY=... node scripts/build-org-playbook.js

const PLAYBOOK_ID = "7dc32266-d7f1-4c83-8712-84483448d57f";
const API = "https://dealflow-ai-api.cfapps.eu12-002.hana.ondemand.com";
const KEY = process.env.DEALFLOW_RUNNER_KEY;

async function createStep(data) {
  const r = await fetch(API + "/api/rest/v1/playbook_steps", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-runner-key": KEY },
    body: JSON.stringify([{
      playbook_id: PLAYBOOK_ID,
      instruction: data.instruction,
      step_order: data.step_order,
      data_bindings: data.data_bindings || null,
      sub_steps: JSON.stringify(data.sub_steps),
    }]),
  });
  if (!r.ok) { console.error(`Step ${data.step_order} FAIL:`, r.status, await r.text().catch(()=>'')); return; }
  const d = await r.json();
  console.log(`✓ Step ${data.step_order}: ${data.instruction.slice(0, 70)}`);
}

// ── Reusable sub-step fragments ──

// Click an element by data-action-name
function jsClick(actionName, label) {
  return { action: "js", code: `document.querySelector('[data-action-name="${actionName}"]')?.click(); '${label}'`, note: label };
}

// Click inline "Create X" link in the table tree
function jsClickInline(unitType) {
  return { action: "js", code: `
    for (const el of document.querySelectorAll('span, a, ui5-link, [role="link"], [data-action-name]')) {
      if (el.textContent.includes('Create ${unitType}')) { el.click(); break; }
    } 'clicked Create ${unitType}'
  `, note: `Click inline Create ${unitType}` };
}

// Fill a side panel input field by element ID
function fillField(elementId, placeholder, label) {
  return { action: "type", id: elementId, value: placeholder, note: label };
}

// Select country/region in the side panel
function selectCountry(placeholder) {
  return { action: "js", code: `
    const sel = document.getElementById('country-region');
    if (sel) { for (const o of sel.querySelectorAll('ui5-option')) {
      if (o.textContent.includes('${placeholder}')) { o.selected = true; break; }
    } sel.dispatchEvent(new Event('change', {bubbles:true})); } 'country set'
  `, note: "Select Country" };
}

// Select a subtype (Storage Location or Shipping Point)
function selectSubtype(placeholder) {
  return { action: "js", code: `
    const sel = document.getElementById('sub-type');
    if (sel) { for (const o of sel.querySelectorAll('ui5-option')) {
      if (o.getAttribute('value') === '${placeholder}' || o.textContent.includes('${placeholder}')) { o.selected = true; break; }
    } sel.dispatchEvent(new Event('change', {bubbles:true})); } 'subtype set'
  `, note: "Select Subtype" };
}

// Select distribution channel or division in Sales Area dialog
function selectDropdown(elementId, placeholder, label) {
  return { action: "js", code: `
    const sel = document.getElementById('${elementId}');
    if (sel) { for (const o of sel.querySelectorAll('ui5-option')) {
      if (o.textContent.includes('${placeholder}')) { o.selected = true; break; }
    } sel.dispatchEvent(new Event('change', {bubbles:true})); } '${label} set'
  `, note: label };
}

// Click the Emphasized Create button in side panel
const clickCreateBtn = { action: "js", code: `
  for (const b of document.querySelectorAll('ui5-button[design="Emphasized"]')) {
    if (b.textContent.trim() === 'Create') { b.click(); break; }
  } 'clicked create'
`, note: "Click Create button" };

const w = (s) => ({ action: "wait", seconds: s });

// ═══════════════════════════════════════════════════════════
// ALL STEPS
// ═══════════════════════════════════════════════════════════

const ALL_STEPS = [

  // ── Step 1: Navigate to Org Structure + Table View ──
  {
    instruction: "Navigate to the Org Structure page and switch to Table View.",
    step_order: 1,
    sub_steps: [
      { action: "js", code: "window.location.hash = '/orgmanagement'; 'navigated'", note: "Nav to org structure" },
      w(4),
      jsClick("switchToTableView", "Switch to Table View"),
      w(2),
    ]
  },

  // ── Step 2: Create Company Code ──
  {
    instruction: "Create Company Code via global Create dropdown. Fill ID, Name, City, Country.",
    step_order: 2,
    sub_steps: [
      { action: "click", id: "createGlobalOrgUnit", tag: "ui5-button", target: "Create", note: "Open Create dropdown" },
      w(1),
      jsClick("openSidePanelForCCDCreation", "Select Company Code"),
      w(2),
      fillField("entity-id", "{cc_id}", "Company Code ID"),
      fillField("entity-name", "{cc_name}", "Company Code Name"),
      fillField("entity-city", "{cc_city}", "City"),
      selectCountry("{cc_country}"),
      w(1),
      clickCreateBtn,
      w(3),
    ]
  },

  // ── Step 3: Create Plant under Company Code ──
  {
    instruction: "Create Plant under the Company Code. Click inline Create Plant link, fill ID, Name, City, Country.",
    step_order: 3,
    sub_steps: [
      jsClickInline("Plant"),
      w(2),
      fillField("entity-id", "{plant_id}", "Plant ID"),
      fillField("entity-name", "{plant_name}", "Plant Name"),
      fillField("entity-city", "{plant_city}", "Plant City"),
      selectCountry("{plant_country}"),
      w(1),
      clickCreateBtn,
      w(3),
    ]
  },

  // ── Step 4: Create Storage Locations under Plant ──
  {
    instruction: "Create two Storage Locations under the Plant: one for Finished Goods (STL_STD_A) and one for Raw Materials (STL_RAW_MATNR).",
    step_order: 4,
    sub_steps: [
      // First Storage Location — Finished Goods
      jsClickInline("Storage Location"),
      w(2),
      fillField("entity-id", "{sloc1_id}", "Storage Location 1 ID"),
      fillField("entity-name", "{sloc1_name}", "Storage Location 1 Name"),
      fillField("entity-city", "{plant_city}", "City"),
      selectSubtype("STL_STD_A"),
      selectCountry("{plant_country}"),
      w(1),
      clickCreateBtn,
      w(3),
      // Second Storage Location — Raw Materials
      jsClickInline("Storage Location"),
      w(2),
      fillField("entity-id", "{sloc2_id}", "Storage Location 2 ID"),
      fillField("entity-name", "{sloc2_name}", "Storage Location 2 Name"),
      fillField("entity-city", "{plant_city}", "City"),
      selectSubtype("STL_RAW_MATNR"),
      selectCountry("{plant_country}"),
      w(1),
      clickCreateBtn,
      w(3),
    ]
  },

  // ── Step 5: Create Sales Organization under Company Code ──
  {
    instruction: "Create Sales Organization under the Company Code. Click inline Create Sales Organization link.",
    step_order: 5,
    sub_steps: [
      jsClickInline("Sales Organization"),
      w(2),
      fillField("entity-id", "{sales_org_id}", "Sales Org ID"),
      fillField("entity-name", "{sales_org_name}", "Sales Org Name"),
      fillField("entity-city", "{cc_city}", "City"),
      selectCountry("{cc_country}"),
      w(1),
      clickCreateBtn,
      w(3),
    ]
  },

  // ── Step 6: Create Distribution Channel + Division (global units) ──
  {
    instruction: "Create Distribution Channel and Division as global org units via the Create dropdown.",
    step_order: 6,
    sub_steps: [
      // Distribution Channel
      { action: "click", id: "createGlobalOrgUnit", tag: "ui5-button", target: "Create", note: "Open Create dropdown" },
      w(1),
      jsClick("openSidePanelForDCHCreation", "Select Distribution Channel"),
      w(2),
      fillField("entity-id", "{dch_id}", "Distribution Channel ID"),
      fillField("entity-name", "{dch_name}", "Distribution Channel Name"),
      w(1),
      clickCreateBtn,
      w(3),
      // Division
      { action: "click", id: "createGlobalOrgUnit", tag: "ui5-button", target: "Create", note: "Open Create dropdown" },
      w(1),
      jsClick("openSidePanelForDIVCreation", "Select Division"),
      w(2),
      fillField("entity-id", "{div_id}", "Division ID"),
      fillField("entity-name", "{div_name}", "Division Name"),
      w(1),
      clickCreateBtn,
      w(3),
    ]
  },

  // ── Step 7: Create Sales Area under Sales Org ──
  {
    instruction: "Create Sales Area under the Sales Organization. The ID is auto-generated from SalesOrg|DCH|DIV.",
    step_order: 7,
    sub_steps: [
      jsClickInline("Sales Area"),
      w(2),
      fillField("entity-name", "{sales_area_name}", "Sales Area Name"),
      selectDropdown("distributionChannel", "{dch_id}", "Select Distribution Channel"),
      selectDropdown("division", "{div_id}", "Select Division"),
      w(1),
      clickCreateBtn,
      w(3),
    ]
  },

  // ── Step 8: Create Purchasing Organization (global) ──
  {
    instruction: "Create Purchasing Organization via global Create dropdown.",
    step_order: 8,
    sub_steps: [
      { action: "click", id: "createGlobalOrgUnit", tag: "ui5-button", target: "Create", note: "Open Create dropdown" },
      w(1),
      jsClick("openSidePanelForPORCreation", "Select Purchasing Organization"),
      w(2),
      fillField("entity-id", "{purch_org_id}", "Purchasing Org ID"),
      fillField("entity-name", "{purch_org_name}", "Purchasing Org Name"),
      selectDropdown("company-code", "{cc_id}", "Assign to Company Code"),
      w(1),
      clickCreateBtn,
      w(3),
    ]
  },

  // ── Step 9: Create Sales Office (global) ──
  {
    instruction: "Create Sales Office via global Create dropdown.",
    step_order: 9,
    sub_steps: [
      { action: "click", id: "createGlobalOrgUnit", tag: "ui5-button", target: "Create", note: "Open Create dropdown" },
      w(1),
      jsClick("openSidePanelForSOFCreation", "Select Sales Office"),
      w(2),
      fillField("entity-id", "{sales_office_id}", "Sales Office ID"),
      fillField("entity-name", "{sales_office_name}", "Sales Office Name"),
      fillField("entity-city", "{cc_city}", "City"),
      selectCountry("{cc_country}"),
      w(1),
      clickCreateBtn,
      w(3),
    ]
  },

  // ── Step 10: Create Shipping Points (Standard + Return) ──
  {
    instruction: "Create Shipping Points: Standard and Return types via global Create dropdown.",
    step_order: 10,
    sub_steps: [
      // Standard Shipping Point
      { action: "click", id: "createGlobalOrgUnit", tag: "ui5-button", target: "Create", note: "Open Create dropdown" },
      w(1),
      jsClick("openSidePanelForSPT_GCreation", "Select Shipping Point"),
      w(2),
      fillField("entity-id", "{ship_std_id}", "Shipping Point ID (Standard)"),
      fillField("entity-name", "{ship_std_name}", "Shipping Point Name"),
      fillField("entity-city", "{plant_city}", "City"),
      selectSubtype("SPT_STD"),
      selectCountry("{plant_country}"),
      w(1),
      clickCreateBtn,
      w(3),
      // Return Shipping Point
      { action: "click", id: "createGlobalOrgUnit", tag: "ui5-button", target: "Create", note: "Open Create dropdown" },
      w(1),
      jsClick("openSidePanelForSPT_GCreation", "Select Shipping Point"),
      w(2),
      fillField("entity-id", "{ship_ret_id}", "Shipping Point ID (Return)"),
      fillField("entity-name", "{ship_ret_name}", "Shipping Point Name"),
      fillField("entity-city", "{plant_city}", "City"),
      selectSubtype("SPT_RAW_MATNR"),
      selectCountry("{plant_country}"),
      w(1),
      clickCreateBtn,
      w(3),
    ]
  },

  // ── Step 11: Complete Activity ──
  {
    instruction: "Complete the Org Structure activity. Click Complete Activity, then Confirm in the confirmation dialog.",
    step_order: 11,
    sub_steps: [
      { action: "js", code: `
        for (const b of document.querySelectorAll('ui5-button[design="Emphasized"]')) {
          if (b.textContent.trim() === 'Complete Activity') { b.click(); break; }
        } 'clicked Complete Activity'
      `, note: "Click Complete Activity" },
      w(3),
      { action: "js", code: `
        for (const b of document.querySelectorAll('ui5-button[design="Emphasized"]')) {
          if (b.textContent.trim() === 'Confirm') { b.click(); break; }
        } 'clicked Confirm'
      `, note: "Click Confirm" },
      w(5),
      { action: "js", code: `
        // Close any milestone progress dialog
        const close = document.getElementById('cancel-milestone-progress-dialog');
        if (close) close.click();
        else { for (const b of document.querySelectorAll('ui5-button')) {
          if (b.textContent.trim() === 'Close') { b.click(); break; }
        }} 'closed dialog'
      `, note: "Close milestone dialog" },
      w(2),
    ]
  },
];

// ═══════════════════════════════════════════════════════════
// EXECUTE — Create all steps in HANA
// ═══════════════════════════════════════════════════════════

async function main() {
  if (!KEY) { console.error("Set DEALFLOW_RUNNER_KEY env var"); process.exit(1); }
  console.log(`Creating ${ALL_STEPS.length} steps for playbook ${PLAYBOOK_ID}...\n`);
  for (const step of ALL_STEPS) {
    await createStep(step);
  }
  console.log(`\nDone. ${ALL_STEPS.length} steps created.`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
