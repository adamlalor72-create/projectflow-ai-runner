---
activity_id: 102934
last_updated: 2026-04-27T00:00:00Z
confidence: medium
verified_by: human-pending
sources:
  - https://userapps.support.sap.com/sap/support/knowledge/en/3137638
  - https://userapps.support.sap.com/sap/support/knowledge/en/3092285
  - https://userapps.support.sap.com/sap/support/knowledge/en/3427139
  - https://userapps.support.sap.com/sap/support/knowledge/en/3628496
  - https://community.sap.com/t5/enterprise-resource-planning-q-a/payment-terms-and-baseline-dates/qaq-p/9994830
---

# Gotchas: Maintain Terms of Payment

## The Explanations field is read-only when Own Explanation is blank
The "Explanations" field in the UI is system-generated from the configured
percentages and days. It only becomes editable indirectly: by populating
the "Own Explanation" field, which then overrides the auto-generated
text. Consultants frequently report this as a bug. It isn't.

## Translation requires logon language switching
There is no translation button on either Own Explanation or Sales Text.
To maintain descriptions in multiple languages, you must log out, log
back in under the target language, and edit the field. The text is then
saved under that language key. The Discovery Agent should treat this as
an out-of-band step, not a UI flow it can automate inside one session.

## Baseline date defaults — four options, easy to get wrong
The "Default for Baseline Date" radio group has four mutually exclusive
options:
- No Default (manual entry at document time)
- Document Date (invoice date as printed on the supplier document)
- Posting Date (date the document is posted in SAP)
- Entry Date (system date when the user actually entered the document)

Common mistake: consultants leave this as Posting Date when business
expects Document Date, then due dates calculate from a different starting
point than the customer's contract specifies. Net result: customers
querying invoices and finance teams overriding manually.

## Fixed Day and Additional Months appear in TWO places — don't confuse them
There are Fixed Day and Additional Months fields under "Default for
Baseline Date" AND under each cash discount line. They do different things:

- Under Default for Baseline Date: shifts the baseline date itself.
  Use when the contract says "baseline is the 15th of next month
  regardless of invoice date".
- Under each cash discount line: shifts the due date relative to the
  baseline. Use when the contract says "net due on 25th of following
  month".

If you have no cash discount, prefer the per-line fields to define the
due date. Shifting the baseline date when there's no discount is
confusing and rarely correct.

## Day Limit creates two records under one key
Setting a Day Limit other than 0 splits the term into two versions: one
for invoices on or before the limit, one for invoices after. The UI may
appear to lose your work — actually it has saved one half and is now
prompting for the other half. Both halves must be configured for the term
to be usable. The Discovery Agent must recognise this as a multi-step
flow, not a single record.

## Credit memos default to baseline date unless linked
A credit memo that is not linked to its original invoice will be due on
the baseline date — i.e. immediately, regardless of the term. To carry
the term across, the original invoice number must be entered in the
Invoice Reference field, OR the user must enter "V" in Invoice Reference
to force the memo to honour the term.

## Cash discount percentages do not have to sum to 100
Unlike installment terms (where percentages must sum to 100), cash
discount tiers are independent thresholds. Three tiers might be 3% / 2% /
0%, with the 0% tier just defining when net is due. The Verify Loop
should not enforce a sum-to-100 rule for cash discount tiers.

## Installment terms: percentages MUST sum to 100
If "Installment Payment" is checked, the term references multiple
sub-terms (each its own payment term) with percentages assigned. These
percentages must sum to exactly 100. Sub-terms must already exist as
separate payment term records. This is configured in a separate sub-flow
(historically the IMG path Define Terms of Payments for Installment
Payments).

## Payment method and payment block default through term, not company code
If you set Payment Method or Payment Block on the payment term, those
values default onto invoices using that term — irrespective of company
code. Consultants who set these on the term and then expect company-code-
specific behaviour are surprised. SAP support note: KBA 3207431.

## Description field saves silently with no UI confirmation
Saving in CBC may show no toast / no banner / no obvious success
indicator on UI5 versions. The Load Engine must verify by re-reading
the record, not by waiting for a confirmation popup.
