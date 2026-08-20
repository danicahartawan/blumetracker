import assert from "node:assert/strict";
import test from "node:test";
import { classifyOrderEmail } from "../server/gmail-order-intake.mjs";

test("classifies the three SOP inbox paths", () => {
  assert.equal(classifyOrderEmail({ subject: "Urgent sample request" }).orderType, "sample_d2c");
  assert.equal(classifyOrderEmail({ subject: "Wholesale invoice", body: "Payment received" }).orderType, "b2b_wholesale");
  assert.equal(classifyOrderEmail({ subject: "PO 104", body: "Needs cases of 6 and a BOL" }).orderType, "direct_netsuite");
});

test("marks an ambiguous email for order-type review", () => {
  assert.equal(classifyOrderEmail({ subject: "Please process this" }).confidence, "low");
});
