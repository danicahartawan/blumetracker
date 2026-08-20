import assert from "node:assert/strict";
import test from "node:test";
import { applyExternalEvent, completeTask, planOrder } from "../lib/order-workflow.mjs";

test("plans Nevan's Johnston workflow across stakeholders", () => {
  const state = planOrder({
    order: { id: "18492", customer: "Johnston", poNumber: "18492", location: "ProPack Delta (CA)", shipDate: "2026-08-17", owner: "Nevan", netSuiteId: "SO-18492", discountPercent: 5, discountApproved: false, pickupRequired: true, s1cStatus: "hold" },
    customerRules: [{ type: "case_pack", required: true }, { type: "floor_display", required: true }],
    warehouseRequests: [], shipment: {}
  });
  assert.deepEqual(state.tasks.map((task) => task.type), [
    "approve_discount", "submit_warehouse_case_pack", "submit_warehouse_floor_display", "review_and_release_s1c", "request_and_attach_bol"
  ]);
  assert.equal(state.tasks.find((task) => task.type === "review_and_release_s1c").requiresApproval, true);
});

test("keeps an incomplete imported order in review instead of rejecting it", () => {
  const state = planOrder({ order: { id: "import-1", poNumber: "PO-1" } });
  assert.equal(state.workflowStatus, "Needs review");
  assert.ok(state.blockers.includes("customer"));
  assert.ok(state.tasks.some((task) => task.type === "complete_required_order_fields"));
});

test("requires confirmation and evidence to complete work", () => {
  const state = planOrder({ order: { id: "1", customer: "Test", s1cStatus: "hold" } });
  assert.throws(() => completeTask(state, "review_and_release_s1c:1", { actor: "Danica", evidence: "ticket-1" }), /--confirm/);
  completeTask(state, "review_and_release_s1c:1", { actor: "Danica", evidence: "ticket-1", confirm: true });
  assert.equal(state.tasks.find((task) => task.id === "review_and_release_s1c:1").status, "completed");
  assert.equal(state.events.at(-1).evidence, "ticket-1");
});

test("only source-system evidence marks an order fulfilled", () => {
  const state = planOrder({ order: { id: "1", customer: "Test", poNumber: "PO1", location: "WH", shipDate: "2026-08-15", owner: "Nevan", netSuiteId: "SO1" } });
  assert.notEqual(state.workflowStatus, "Fulfilled");
  assert.throws(() => applyExternalEvent(state, { source: "email", type: "fulfillment_confirmed", eventId: "x" }, { confirm: true }), /source must/);
  applyExternalEvent(state, { source: "netsuite", type: "fulfillment_confirmed", eventId: "IF-100" }, { confirm: true });
  assert.equal(state.workflowStatus, "Fulfilled");
  assert.equal(state.statusEvidence, "IF-100");
  assert.equal(state.events.at(-1).source, "netsuite");
});
