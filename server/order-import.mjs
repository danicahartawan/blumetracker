import XLSX from "xlsx";
import { planOrder } from "../lib/order-workflow.mjs";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const text = (value) => value == null ? "" : String(value).trim();
const nullable = (value) => text(value) || null;

function date(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function value(row, ...names) {
  const entries = Object.entries(row || {});
  for (const name of names) {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = entries.find(([key]) => key.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized);
    if (match && match[1] !== null && match[1] !== "") return match[1];
  }
  return null;
}

function asBoolean(value) {
  return /^(yes|y|true|1|sent|submitted)$/i.test(text(value));
}

export function normalizeImportedOrder(row, index = 0, source = "file_import", selectedOrderType = null) {
  const netSuiteId = nullable(value(row, "Document Number", "NetSuite Order ID", "NetSuite ID", "Sales Order"));
  const poNumber = nullable(value(row, "PO #", "PO Number", "Purchase Order", "Purchase Order Number"));
  const customer = text(value(row, "Customer", "Customer Name", "Business Name", "Bill To"));
  const id = text(value(row, "id")) || netSuiteId || poNumber || `import-${Date.now()}-${index}`;
  const explicitType = text(value(row, "Order Type", "Channel", "Workflow Type")).toLowerCase();
  const orderType = selectedOrderType || (/sample|d2c/.test(explicitType) ? "sample_d2c" : /wholesale|b2b/.test(explicitType) ? "b2b_wholesale" : "direct_netsuite");
  const raw = {
    id, netSuiteId: netSuiteId || "", poNumber, customer,
    location: text(value(row, "Location", "Warehouse", "Ship To")),
    orderDate: date(value(row, "Date", "Order Date")),
    shipDate: date(value(row, "Ship date (M/D/Y)", "Ship date", "Requested Ship Date")),
    deliverBy: date(value(row, "Deliver by (M/D/Y)", "Deliver by", "Delivery Date")),
    memo: text(value(row, "Memo", "Notes", "Special Instructions")),
    amount: value(row, "Amount", "Order Value", "Total") == null ? null : Number(value(row, "Amount", "Order Value", "Total")),
    shipVia: text(value(row, "Ship Via", "Carrier")),
    netSuiteStatus: text(value(row, "Order Status", "NetSuite Status")) || "Pending creation",
    owner: nullable(value(row, "Owner")),
    wrikeSubmitted: nullable(value(row, "Wrike submitted?", "Warehouse Request Status", "Wrike Status")),
    asnSent: asBoolean(value(row, "ASN Sent")),
    source, orderType
  };
  const warehouseRequests = raw.wrikeSubmitted ? [{ type: "special_handling", status: raw.wrikeSubmitted, source: "wrike" }] : [];
  const planned = planOrder({ order: raw, customerRules: [], warehouseRequests, shipment: { shipVia: raw.shipVia, asnSent: raw.asnSent } });
  const requiresRuleReview = !raw.wrikeSubmitted;
  return {
    ...raw,
    workflowStatus: planned.workflowStatus === "Ready to release" && requiresRuleReview ? "Needs review" : planned.workflowStatus,
    nextAction: orderType === "sample_d2c" ? "Verify sample SKUs and SuperSync mapping" : orderType === "b2b_wholesale" ? "Validate discount, invoice, and payment" : requiresRuleReview ? "Review customer rules and Wrike request" : planned.nextAction,
    workflowTasks: planned.tasks,
    workflowChecks: { customerRulesReviewed: false, wrikeRequestFound: Boolean(raw.wrikeSubmitted), stordReady: false, netSuiteReady: Boolean(raw.netSuiteId) }
  };
}

export function parseXlsxOrders(buffer, { orderType = null } = {}) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("The workbook has no sheets.");
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: null });
    const hasOrderHeaders = rows.some((row) => value(row, "Document Number", "NetSuite Order ID", "PO #", "PO Number", "Customer"));
    if (!hasOrderHeaders) continue;
    const orders = rows.map((row, index) => normalizeImportedOrder(row, index, "xlsx_import", orderType))
      .filter((order) => order.netSuiteId || order.poNumber || order.customer);
    if (orders.length) return orders;
  }
  throw new Error("No order rows were found in the workbook.");
}

const orderSchema = {
  type: "object", additionalProperties: false,
  properties: {
    netSuiteId: { type: ["string", "null"] }, poNumber: { type: ["string", "null"] }, customer: { type: ["string", "null"] },
    location: { type: ["string", "null"] }, orderDate: { type: ["string", "null"] }, shipDate: { type: ["string", "null"] },
    deliverBy: { type: ["string", "null"] }, memo: { type: ["string", "null"] }, amount: { type: ["number", "null"] },
    shipVia: { type: ["string", "null"] }, owner: { type: ["string", "null"] }
  },
  required: ["netSuiteId", "poNumber", "customer", "location", "orderDate", "shipDate", "deliverBy", "memo", "amount", "shipVia", "owner"]
};

export async function parsePdfOrder(buffer, { env = process.env, fetchImpl = fetch, orderType = null } = {}) {
  if (!env.OPENAI_API_KEY) throw new Error("PDF import requires OPENAI_API_KEY on the server. XLSX import works without it.");
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_ORDER_MODEL || "gpt-5.4",
      store: false,
      instructions: "Extract one purchase order into the provided schema. Use ISO YYYY-MM-DD dates. Never invent missing values; return null.",
      input: [{ role: "user", content: [{ type: "input_text", text: "Extract this purchase order for human review before it is added to the order workflow." }, { type: "input_file", filename: "purchase-order.pdf", file_data: `data:application/pdf;base64,${buffer.toString("base64")}` }] }],
      text: { format: { type: "json_schema", name: "purchase_order", strict: true, schema: orderSchema } }
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `OpenAI PDF extraction failed (${response.status}).`);
  const output = body.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new Error("The PDF did not produce an order.");
  return [normalizeImportedOrder(JSON.parse(output), 0, "pdf_import", orderType)];
}

export async function readImportBody(request, maxBytes = MAX_IMPORT_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Import files must be 20 MB or smaller.");
    chunks.push(chunk);
  }
  if (!chunks.length) throw new Error("Choose an XLSX or PDF file.");
  return Buffer.concat(chunks);
}
