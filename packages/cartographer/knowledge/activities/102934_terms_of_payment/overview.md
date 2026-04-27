---
activity_id: 102934
activity_name: "Maintain Terms of Payment"
last_updated: 2026-04-27T00:00:00Z
confidence: medium
verified_by: human-pending
sources:
  - https://learning.sap.com/courses/customizing-core-settings-in-financial-accounting-in-sap-s4hana/configuring-payment-terms-and-cash-discounts
  - https://blog.sap-press.com/customizing-customer-invoices-and-credit-memos-in-sap-s4hana
  - https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/configuring-terms-of-payment/ba-p/13283659
related_activities:
  - 101044  # Payment Method per Company Code
scope_item_refs: []  # to be confirmed against 2602 matrix
---

# Maintain Terms of Payment (SSCUI 102934)

## Business purpose
Defines the rules SAP uses to automatically calculate due dates and cash
discounts on customer and vendor invoices. A four-character key holds the
rule. The key is assigned to the customer or vendor master record and then
proposed automatically when invoices are entered, though it can be
overridden at document level.

This activity configures the payment terms catalogue. It does not assign
terms to specific business partners — that happens in master data.

## Where it sits in CBC
Manage Your Solution > Configure Your Solution > Finance > Accounts
Receivable > Make Settings for Automatic Payments > Payment Terms >
Configure
(also reachable under Accounts Payable > General Payment Settings)

Underlying ECC transaction: OB88 (legacy reference, S/4 Cloud uses the
SSCUI not the t-code).

## Account type
Each payment term applies to customers, vendors, or both. Same key can be
configured to behave differently for AR vs AP if needed, though this is
unusual.

## How it's used downstream
- Customer master record: assigned at sales area level, defaults onto sales
  orders and customer invoices
- Vendor master record: assigned at company code level, defaults onto
  purchase orders and supplier invoices
- Document entry: defaulted from master data, can be overridden manually
- Net due date and cash discount amounts are calculated by the system
  using the term's rules at posting time

## Dependencies (must exist before this activity is configured)
- Company codes (terms can be referenced from company code-specific master
  data; the term itself is client-wide)
- Currencies (no direct dependency for the term key, but cash discount
  postings need GL accounts in the relevant currencies)
- Document types and posting periods (so test transactions can be posted
  to verify the term works)
- Cash discount GL accounts configured (for cash-discount-bearing terms
  to actually post discount amounts)

## How to verify a payment term is configured correctly
1. Post a test invoice (FB60 for vendor, FB70 for customer) using a BP
   that has the new term assigned, or override the term at line level
2. Check the calculated baseline date matches expectation
3. Check the calculated net due date matches expectation
4. If cash-discount-bearing, check the discount amount and discount due
   date display correctly on the document
5. Run automatic payment program (F110) in test mode and confirm the
   payment proposal respects the term

## Notes on language and translation
Descriptions are language-dependent. The Own Explanation field must be
maintained per logon language — there is no translation popup. Sales Text
likewise has no translation button; you must log in under each target
language to maintain that language's text. If Own Explanation is left
blank, SAP auto-generates the description from the configured days and
percentages.
