import assert from "node:assert/strict";
import test from "node:test";
import XLSX from "xlsx";
import { normalizeImportedOrder, parseXlsxOrders } from "../server/order-import.mjs";

test("normalizes a tracker row and queues rule/Wrike review", () => {
  const order = normalizeImportedOrder({ "Document Number": "SO-9", "PO #": "PO-9", Customer: "Acme", Location: "Delta", "Ship date\n(M/D/Y)": "2026-08-25", Owner: "Nevan" });
  assert.equal(order.netSuiteId, "SO-9");
  assert.equal(order.shipDate, "2026-08-25");
  assert.equal(order.workflowStatus, "Needs review");
  assert.equal(order.nextAction, "Review customer rules and Wrike request");
  assert.equal(order.workflowChecks.wrikeRequestFound, false);
});

test("assigns the selected SOP and its first gate", () => {
  const sample = normalizeImportedOrder({ Customer: "Press", "PO #": "S-1" }, 0, "pdf_import", "sample_d2c");
  const wholesale = normalizeImportedOrder({ Customer: "Retailer", "PO #": "W-1" }, 0, "xlsx_import", "b2b_wholesale");
  assert.equal(sample.orderType, "sample_d2c");
  assert.match(sample.nextAction, /sample SKUs/);
  assert.equal(wholesale.orderType, "b2b_wholesale");
  assert.match(wholesale.nextAction, /payment/);
});

test("reads order rows from an XLSX buffer", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Dashboard"], ["No order table here"]]), "Control Room");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ "Document Number": "SO-10", "PO #": "PO-10", Customer: "Johnston" }]), "Orders");
  const orders = parseXlsxOrders(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  assert.equal(orders.length, 1);
  assert.equal(orders[0].customer, "Johnston");
  assert.ok(orders[0].workflowTasks.some((task) => task.type === "complete_required_order_fields"));
});

test("PDF extraction requires a server-side key", async () => {
  const { parsePdfOrder } = await import("../server/order-import.mjs");
  await assert.rejects(() => parsePdfOrder(Buffer.from("pdf"), { env: {} }), /OPENAI_API_KEY/);
});
