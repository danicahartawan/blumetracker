const definitions = [
  { id: "gmail", name: "Gmail", purpose: "Receive customer POs and attachments", required: ["GMAIL_ACCESS_TOKEN"], optional: ["GMAIL_LABEL_ID"], capabilities: ["read_mailbox_profile", "receive_po_email"], writeCapabilities: [] },
  { id: "netsuite", name: "NetSuite", purpose: "Read canonical sales-order status", required: ["NETSUITE_BASE_URL", "NETSUITE_ACCESS_TOKEN"], optional: ["NETSUITE_SUITEQL"], capabilities: ["read_sales_orders", "refresh_order_status"], writeCapabilities: [] },
  { id: "typeform", name: "Typeform", purpose: "Receive special-handling requests", required: ["TYPEFORM_TOKEN"], optional: ["TYPEFORM_FORM_ID", "TYPEFORM_WEBHOOK_SECRET"], capabilities: ["read_account", "receive_handling_request"], writeCapabilities: [] },
  { id: "wrike", name: "Wrike", purpose: "Track task ownership and status", required: ["WRIKE_TOKEN"], optional: ["WRIKE_FOLDER_ID", "WRIKE_WEBHOOK_SECRET"], capabilities: ["read_tasks", "receive_task_update"], writeCapabilities: [] },
  { id: "stord_s1c", name: "STORD / S1C", purpose: "Read warehouse fulfillment evidence", required: ["STORD_MCP_URL", "STORD_MCP_ACCESS_TOKEN"], optional: ["STORD_ORG_ID", "STORD_FACILITY_ID"], capabilities: ["discover_tools", "read_fulfillment_status"], writeCapabilities: [] },
  { id: "google_sheets", name: "Google Sheets", purpose: "Publish an operations view", required: ["GOOGLE_ACCESS_TOKEN", "GOOGLE_SHEET_ID"], optional: ["GOOGLE_DRIVE_FOLDER_ID"], capabilities: ["read_spreadsheet"], writeCapabilities: [] }
];

export function connectionConfiguration(env = process.env) {
  return definitions.map((definition) => {
    const missing = definition.required.filter((name) => !env[name]);
    return {
      id: definition.id,
      name: definition.name,
      purpose: definition.purpose,
      configured: missing.length === 0,
      status: missing.length === 0 ? "configured_unverified" : "disconnected",
      missing,
      optionalMissing: definition.optional.filter((name) => !env[name]),
      capabilities: definition.capabilities,
      writeCapabilities: definition.writeCapabilities,
      readOnly: definition.writeCapabilities.length === 0
    };
  });
}

async function request(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(12000), headers: { accept: "application/json", ...options.headers } });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(`${response.status} ${body?.error?.message || body?.message || response.statusText}`);
  return body;
}

export async function probeConnections({ env = process.env, fetchImpl = fetch } = {}) {
  const config = connectionConfiguration(env);
  const probes = {
    gmail: () => request(fetchImpl, "https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: `Bearer ${env.GMAIL_ACCESS_TOKEN}` } }),
    netsuite: () => request(fetchImpl, `${String(env.NETSUITE_BASE_URL).replace(/\/$/, "")}/services/rest/record/v1/metadata-catalog?select=salesorder`, { headers: { authorization: `Bearer ${env.NETSUITE_ACCESS_TOKEN}` } }),
    typeform: () => request(fetchImpl, "https://api.typeform.com/me", { headers: { authorization: `Bearer ${env.TYPEFORM_TOKEN}` } }),
    wrike: () => request(fetchImpl, "https://www.wrike.com/api/v4/contacts?me=true", { headers: { authorization: `Bearer ${env.WRIKE_TOKEN}` } }),
    stord_s1c: () => probeStordMcp({ env, fetchImpl }),
    google_sheets: () => request(fetchImpl, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID)}?fields=spreadsheetId,properties.title`, { headers: { authorization: `Bearer ${env.GOOGLE_ACCESS_TOKEN}` } })
  };
  return Promise.all(config.map(async (item) => {
    if (!item.configured) return { ...item, status: "disconnected", live: false, ok: false, detail: "configuration incomplete" };
    try {
      const result = await probes[item.id]();
      return { ...item, status: "connected", live: true, ok: true, detail: summarizeProbe(item.id, result) };
    } catch (error) {
      return { ...item, status: "error", live: true, ok: false, detail: error.message };
    }
  }));
}

function parseMcpBody(text) {
  try { return JSON.parse(text); } catch {}
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { return JSON.parse(line.slice(5).trim()); } catch {}
  }
  return { text: text.slice(0, 300) };
}

export async function discoverStordMcp({ fetchImpl = fetch, mcpUrl = "https://gateway.stord.com/mcp" } = {}) {
  const target = new URL(mcpUrl);
  const protectedUrl = `${target.origin}/.well-known/oauth-protected-resource${target.pathname}`;
  const protectedResource = await request(fetchImpl, protectedUrl);
  const authorizationServer = protectedResource.authorization_servers?.[0];
  if (!authorizationServer) throw new Error("STORD MCP did not advertise an OAuth authorization server");
  const oauth = await request(fetchImpl, `${authorizationServer}/.well-known/oauth-authorization-server`);
  return { mcpUrl, protectedResource, oauth };
}

export async function probeStordMcp({ env = process.env, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(env.STORD_MCP_URL || "https://gateway.stord.com/mcp", {
    method: "POST",
    signal: AbortSignal.timeout(12000),
    headers: {
      authorization: `Bearer ${env.STORD_MCP_ACCESS_TOKEN}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "blume-order-control", version: "0.1.0" } } })
  });
  const text = await response.text();
  const body = parseMcpBody(text);
  if (!response.ok) throw new Error(`${response.status} ${body?.error?.message || body?.message || response.statusText}`);
  if (body.error) throw new Error(body.error.message || "STORD MCP initialization failed");
  return { serverInfo: body.result?.serverInfo || null, protocolVersion: body.result?.protocolVersion || null };
}

function summarizeProbe(id, body) {
  if (id === "gmail") return body.emailAddress || "mailbox reachable";
  if (id === "typeform") return body.alias || body.email || "account reachable";
  if (id === "wrike") return body.data?.[0]?.title || "account reachable";
  if (id === "google_sheets") return body.properties?.title || body.spreadsheetId || "sheet reachable";
  return "read-only probe succeeded";
}

export async function fetchNetSuiteOrders({ env = process.env, fetchImpl = fetch, limit = 100 } = {}) {
  if (!env.NETSUITE_BASE_URL || !env.NETSUITE_ACCESS_TOKEN) throw new Error("NETSUITE_BASE_URL and NETSUITE_ACCESS_TOKEN are required");
  const query = env.NETSUITE_SUITEQL || "SELECT id, tranid, trandate, entity, otherrefnum, location, shipdate, memo, foreigntotal, status FROM transaction WHERE type = 'SalesOrd' ORDER BY trandate DESC";
  const base = String(env.NETSUITE_BASE_URL).replace(/\/$/, "");
  const body = await request(fetchImpl, `${base}/services/rest/query/v1/suiteql?limit=${Math.min(Math.max(Number(limit) || 100, 1), 1000)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.NETSUITE_ACCESS_TOKEN}`, "content-type": "application/json", prefer: "transient" },
    body: JSON.stringify({ q: query })
  });
  return (body.items || []).map((item) => ({
    id: String(item.id), netSuiteId: item.tranid, poNumber: item.otherrefnum || null, customer: String(item.entity || ""), location: String(item.location || ""),
    orderDate: item.trandate || null, shipDate: item.shipdate || null, memo: item.memo || "", amount: item.foreigntotal ?? null,
    netSuiteStatus: item.status || "", owner: null, source: "netsuite", sourceRecordId: String(item.id), orderType: "direct_netsuite"
  }));
}
