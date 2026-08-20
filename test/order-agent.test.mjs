import assert from "node:assert/strict";
import test from "node:test";
import { analyzeOrder, findOrder, refreshOrderStatuses } from "../server/order-agent.mjs";

const order = { id: "42", netSuiteId: "SO42", poNumber: "PO42", customer: "Acme", workflowStatus: "Blocked", netSuiteStatus: "On Hold", shipDate: "2026-08-20", blocker: "Approval required" };

test("finds an order using local, NetSuite, or PO identifiers", () => {
  assert.equal(findOrder([order], "so42"), order);
  assert.equal(findOrder([order], "PO42"), order);
});

test("local order agent is grounded, read-only, and names disconnected systems", () => {
  const result = analyzeOrder(order, { prompt: "What should I do?", env: {} });
  assert.equal(result.mode, "deterministic_local");
  assert.equal(result.readOnly, true);
  assert.match(result.answer, /SO42 is Blocked/);
  assert.ok(result.analysis.disconnectedSystems.includes("NetSuite"));
  assert.ok(result.suggestedActions.every((action) => action.requiresHuman));
  assert.equal(JSON.stringify(result).includes("undefined"), false);
});

test("refresh returns the unchanged local snapshot when NetSuite is disconnected", async () => {
  const result = await refreshOrderStatuses({ currentOrders: [order], env: {} });
  assert.equal(result.orders[0], order);
  assert.equal(result.orderSync.source, "local_snapshot");
  assert.equal(result.orderSync.live, false);
  assert.match(result.orderSync.detail, /not connected/);
});

test("refresh reads NetSuite when configured", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ items: [{ id: 7, tranid: "SO7", entity: "Acme", status: "Open" }] }), { status: 200 });
  const result = await refreshOrderStatuses({ currentOrders: [], env: { NETSUITE_BASE_URL: "https://acct.example", NETSUITE_ACCESS_TOKEN: "secret" }, fetchImpl });
  assert.equal(result.orders[0].netSuiteId, "SO7");
  assert.equal(result.orderSync.source, "netsuite");
  assert.equal(result.orderSync.live, true);
});
