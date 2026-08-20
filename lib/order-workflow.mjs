import { readFile, writeFile } from "node:fs/promises";

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function task(type, ownerRole, reason, options = {}) {
  return {
    id: `${type}:${options.orderId || "order"}`,
    type,
    ownerRole,
    status: "open",
    reason,
    requiresApproval: Boolean(options.requiresApproval),
    externalSystem: options.externalSystem || null,
    evidence: []
  };
}

export function planOrder(input) {
  const order = input.order || input;
  if (!order.id) throw new Error("order.id is required");
  const rules = input.customerRules || [];
  const requests = input.warehouseRequests || [];
  const shipment = input.shipment || {};
  const tasks = [];
  const orderId = order.id;
  const requiredFields = ["id", "customer", "poNumber", "location", "shipDate", "owner"];
  const missingFields = requiredFields.filter((field) => !order[field]);

  if (!order.netSuiteId) {
    tasks.push(task("match_or_create_netsuite_order", "order_operations", "The PO is not linked to a NetSuite sales order.", { orderId, requiresApproval: true, externalSystem: "netsuite" }));
  }
  if (missingFields.length) {
    tasks.push(task("complete_required_order_fields", "order_operations", `Missing required fields: ${missingFields.join(", ")}.`, { orderId, externalSystem: "netsuite" }));
  }
  if (order.discountPercent && !order.discountApproved) {
    tasks.push(task("approve_discount", "finance", `${order.discountPercent}% discount requires finance verification.`, { orderId, requiresApproval: true, externalSystem: "netsuite" }));
  }

  const requiredHandling = new Set();
  for (const rule of rules) {
    if (["case_pack", "floor_display", "shelf_life", "lot_requirement"].includes(rule.type) && rule.required !== false) requiredHandling.add(rule.type);
  }
  for (const type of requiredHandling) {
    const found = requests.some((request) => request.type === type && ["submitted", "accepted", "completed"].includes(request.status));
    if (!found) tasks.push(task(`submit_warehouse_${type}`, "order_operations", `Customer rule '${type}' has no submitted warehouse request.`, { orderId, externalSystem: "typeform" }));
  }

  if (order.s1cStatus === "hold") {
    tasks.push(task("review_and_release_s1c", "order_operations", "Order is deliberately held until customer rules, discount, and warehouse handling are verified.", { orderId, requiresApproval: true, externalSystem: "stord_s1c" }));
  }
  if (order.pickupRequired && !shipment.bolNumber) {
    tasks.push(task("request_and_attach_bol", "transportation_pickup", "Pickup order has no bill of lading attached.", { orderId, externalSystem: "stord_s1c" }));
  }
  if (["shipped", "picked_up"].includes(shipment.status) && !shipment.trackingNumber) {
    tasks.push(task("confirm_tracking", "transportation_pickup", "Shipment is moving but tracking evidence is missing.", { orderId, externalSystem: "stord_s1c" }));
  }

  const fulfillmentEvidence = shipment.fulfillmentEventId || order.netSuiteItemFulfillmentId || null;
  const warehouseEvidence = shipment.warehouseEventId || null;
  let workflowStatus = "Ready to release";
  if (fulfillmentEvidence) workflowStatus = "Fulfilled";
  else if (["backordered", "on hold"].includes(String(order.netSuiteStatus || "").toLowerCase()) || order.s1cStatus === "hold" || shipment.stordStatus === "held") workflowStatus = "Blocked";
  else if (missingFields.length || !order.netSuiteId) workflowStatus = "Needs review";
  else if (warehouseEvidence && ["released", "picking", "shipped"].includes(String(shipment.stordStatus || "").toLowerCase())) workflowStatus = "Sent to warehouse";
  const nextAction = workflowStatus === "Fulfilled" ? "No action" : workflowStatus === "Blocked" ? "Resolve blocker and re-verify" : workflowStatus === "Needs review" ? "Complete required order fields" : workflowStatus === "Sent to warehouse" ? "Monitor pick/ship evidence" : "Review customer rules and approve release";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    order,
    customerRules: rules,
    warehouseRequests: requests,
    shipment,
    workflowStatus,
    completeness: (requiredFields.length - missingFields.length) / requiredFields.length,
    blockers: missingFields,
    nextAction,
    statusEvidence: fulfillmentEvidence || warehouseEvidence,
    tasks,
    events: [{ at: new Date().toISOString(), type: "workflow_planned", actor: "blume-cli", detail: `${tasks.length} task(s) generated` }]
  };
}

export function applyExternalEvent(state, event, { confirm }) {
  if (!confirm) throw new Error("Mutation refused. Pass --confirm after reviewing the event.");
  if (!event?.eventId) throw new Error("eventId is required");
  if (!event?.source || !["netsuite", "stord_s1c"].includes(event.source)) throw new Error("source must be netsuite or stord_s1c");
  if (!event?.type || !["warehouse_accepted", "released", "picking", "shipped", "fulfillment_confirmed"].includes(event.type)) throw new Error("Unsupported external event type");
  state.events ||= [];
  if (state.events.some((item) => item.source === event.source && item.eventId === event.eventId)) return state;
  state.shipment ||= {};
  const now = event.at || new Date().toISOString();
  if (event.type === "fulfillment_confirmed") {
    state.shipment.status = "fulfilled";
    state.shipment.fulfillmentEventId = event.eventId;
    state.workflowStatus = "Fulfilled";
    state.nextAction = "No action";
    state.statusEvidence = event.eventId;
  } else {
    state.shipment.stordStatus = event.type === "warehouse_accepted" ? "released" : event.type;
    state.shipment.warehouseEventId = event.eventId;
    state.workflowStatus = "Sent to warehouse";
    state.nextAction = "Monitor pick/ship evidence";
    state.statusEvidence = event.eventId;
  }
  state.events.push({ at: now, type: event.type, source: event.source, eventId: event.eventId, actor: "external-system" });
  return state;
}

export function completeTask(state, taskId, { actor, evidence, confirm }) {
  if (!confirm) throw new Error("Mutation refused. Pass --confirm after reviewing the task.");
  if (!actor) throw new Error("--actor is required");
  if (!evidence) throw new Error("--evidence is required");
  const selected = state.tasks.find((item) => item.id === taskId);
  if (!selected) throw new Error(`Task not found: ${taskId}`);
  selected.status = "completed";
  selected.completedAt = new Date().toISOString();
  selected.completedBy = actor;
  selected.evidence.push(evidence);
  state.events.push({ at: selected.completedAt, type: "task_completed", actor, taskId, evidence });
  return state;
}

export async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
