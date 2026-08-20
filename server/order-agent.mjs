import { connectionConfiguration, fetchNetSuiteOrders } from "./order-connectors.mjs";

const heldStatuses = new Set(["blocked", "on hold", "backordered", "held"]);

function value(order, ...keys) {
  for (const key of keys) if (order?.[key] !== undefined && order[key] !== null && order[key] !== "") return order[key];
  return null;
}

export function findOrder(orders, identifier) {
  const wanted = String(identifier || "").toLowerCase();
  return (orders || []).find((order) => [order.id, order.netSuiteId, order.poNumber].some((candidate) => String(candidate || "").toLowerCase() === wanted));
}

export function analyzeOrder(order, { prompt = "", env = process.env } = {}) {
  const connections = connectionConfiguration(env);
  const disconnectedSystems = connections.filter((item) => !item.configured).map((item) => item.name);
  const status = String(value(order, "workflowStatus", "status") || "Needs review");
  const netSuiteStatus = String(value(order, "netSuiteStatus") || "Unknown");
  const blocker = value(order, "blocker");
  const missing = [];
  if (!value(order, "netSuiteId")) missing.push("NetSuite order ID");
  if (!value(order, "customer")) missing.push("customer");
  if (!value(order, "poNumber")) missing.push("PO number");
  if (!value(order, "shipDate")) missing.push("ship date");
  if (!value(order, "owner")) missing.push("owner");
  const isHeld = heldStatuses.has(status.toLowerCase()) || heldStatuses.has(netSuiteStatus.toLowerCase()) || Boolean(blocker);
  const suggestedActions = [];
  if (missing.length) suggestedActions.push({ id: "complete_order_data", label: `Complete missing data: ${missing.join(", ")}`, requiresHuman: true });
  if (isHeld) suggestedActions.push({ id: "resolve_blocker", label: blocker ? `Resolve blocker: ${blocker}` : `Review ${netSuiteStatus} status`, requiresHuman: true });
  if (!isHeld && !missing.length) suggestedActions.push({ id: "review_release", label: "Review order for release", requiresHuman: true });
  if (!connections.find((item) => item.id === "netsuite")?.configured) suggestedActions.push({ id: "connect_netsuite", label: "Connect NetSuite to refresh authoritative status", requiresHuman: true });

  const identity = value(order, "netSuiteId", "id") || "this order";
  const question = String(prompt || "").trim();
  const answer = `${identity} is ${status}; NetSuite status is ${netSuiteStatus}. ${blocker ? `Current blocker: ${blocker}. ` : ""}${missing.length ? `Missing: ${missing.join(", ")}. ` : "Required local fields are present. "}${disconnectedSystems.length ? `Disconnected systems: ${disconnectedSystems.join(", ")}.` : "All configured systems are available for verification."}`;
  return {
    mode: "deterministic_local",
    readOnly: true,
    prompt: question,
    answer,
    order: { id: order.id, netSuiteId: value(order, "netSuiteId"), poNumber: value(order, "poNumber"), customer: value(order, "customer"), status, netSuiteStatus, shipDate: value(order, "shipDate"), owner: value(order, "owner"), blocker },
    analysis: { held: isHeld, missingFields: missing, disconnectedSystems },
    suggestedActions,
    notice: "Suggestions are grounded in the local order snapshot and do not execute changes. A human must approve external actions."
  };
}

export async function refreshOrderStatuses({ currentOrders = [], env = process.env, fetchImpl = fetch, limit = 100 } = {}) {
  const netsuite = connectionConfiguration(env).find((item) => item.id === "netsuite");
  const refreshedAt = new Date().toISOString();
  if (!netsuite?.configured) {
    return { orders: currentOrders, orderSync: { source: "local_snapshot", readOnly: true, refreshedAt, count: currentOrders.length, changed: 0, live: false, status: "disconnected", detail: "NetSuite is not connected; showing the existing local snapshot." } };
  }
  const orders = await fetchNetSuiteOrders({ env, fetchImpl, limit });
  return { orders, orderSync: { source: "netsuite", readOnly: true, refreshedAt, syncedAt: refreshedAt, count: orders.length, changed: null, live: true, status: "connected", detail: "Order statuses refreshed from NetSuite using read-only SuiteQL." } };
}
