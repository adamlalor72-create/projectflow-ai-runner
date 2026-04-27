---
activity_id: 102934
last_updated: 2026-04-27T00:00:00Z
confidence: medium
verified_by: human-pending
purpose: "Three test records that exercise the main feature surface of the activity. Used by the Verify Loop to prove a candidate UI Map handles realistic data."
---

# Test Data Recipes: Maintain Terms of Payment

## Recipe 1 — Plain Net 30 (smoke test)
The simplest possible term. If the Load Engine can't load this, nothing
else will work.

| Field | Value |
|---|---|
| Payment Terms key | NT30 |
| Sales Text | Net 30 days |
| Day Limit | 0 |
| Account Type | Customer + Vendor (both) |
| Default for Baseline Date | Document Date |
| Fixed Day (baseline) | (blank) |
| Additional Months (baseline) | (blank) |
| Cash discount tier 1 % | 0.000 |
| Cash discount tier 1 days | 30 |
| Cash discount tier 2 | (blank) |
| Cash discount tier 3 | (blank) |
| Installment Payment | unchecked |
| Own Explanation | Net 30 days from invoice date |

Verification: invoice posted 1 Jan should produce due date 31 Jan, no
discount.

## Recipe 2 — 2/10 Net 30 (cash discount)
Standard early payment discount term. Tests cash discount tier handling.

| Field | Value |
|---|---|
| Payment Terms key | T210 |
| Sales Text | 2% 10 days, Net 30 |
| Day Limit | 0 |
| Account Type | Customer + Vendor |
| Default for Baseline Date | Document Date |
| Cash discount tier 1 % | 2.000 |
| Cash discount tier 1 days | 10 |
| Cash discount tier 2 % | 0.000 |
| Cash discount tier 2 days | 30 |
| Cash discount tier 3 | (blank) |
| Installment Payment | unchecked |
| Own Explanation | 2% discount within 10 days, otherwise net 30 |

Verification: invoice posted 1 Jan, paid 8 Jan should compute 2%
discount. Same invoice paid 25 Jan should compute zero discount but
remain within net due of 31 Jan.

## Recipe 3 — Net Due 25th of Following Month (date-shifted due date)
Tests the "Fixed Day + Additional Months" behaviour on the cash discount
line (NOT the baseline default), which is the correct way to model
"due on a fixed calendar date" terms.

| Field | Value |
|---|---|
| Payment Terms key | T25N |
| Sales Text | Net due 25th of following month |
| Day Limit | 0 |
| Account Type | Customer only |
| Default for Baseline Date | Document Date |
| Fixed Day (baseline) | (blank) |
| Additional Months (baseline) | (blank) |
| Cash discount tier 1 % | 0.000 |
| Cash discount tier 1 days | 0 |
| Cash discount tier 1 fixed day | 25 |
| Cash discount tier 1 additional months | 1 |
| Installment Payment | unchecked |
| Own Explanation | Net due 25th of following month from invoice date |

Verification: invoice with document date 10 Jan should produce due date
25 Feb. Invoice with document date 28 Feb should produce due date
25 Mar.

## Why these three
- Recipe 1 exercises the basic field set. If discovery missed any
  required field, this will fail and surface it.
- Recipe 2 exercises multi-tier cash discount, which has caught Discovery
  Agents before because the dynamic "add tier" button is a row-add
  pattern, not a static field.
- Recipe 3 exercises Fixed Day / Additional Months on the discount line
  rather than the baseline. This is the misconfiguration that catches
  most junior consultants and proves the Map captured the right field.

## Negative test cases (Verify Loop should run these too)
- Save a duplicate key — should be rejected with a "key already exists"
  error. Capture the error locator and message in the Map's error
  dictionary.
- Save with installment + cash discount both checked — should be
  rejected; these are mutually exclusive.
- Save installment with percentages summing to 90 — should be rejected.
- Save with a 4-character key containing lowercase — accepted but auto-
  uppercased; verify the saved record matches expected form.
