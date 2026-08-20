import assert from "node:assert/strict";
import test from "node:test";
import { connectionConfiguration, discoverStordMcp, fetchNetSuiteOrders, probeConnections, probeStordMcp } from "../server/order-connectors.mjs";

test("connection doctor lists missing variables without exposing secrets", () => {
  const result = connectionConfiguration({ NETSUITE_BASE_URL: "https://example.test" });
  const netsuite = result.find((item) => item.id === "netsuite");
  assert.equal(netsuite.configured, false);
  assert.deepEqual(netsuite.missing, ["NETSUITE_ACCESS_TOKEN"]);
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("live probes use read-only account endpoints", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method || "GET" });
    return new Response(JSON.stringify({ emailAddress: "test@example.com" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await probeConnections({ env: { GMAIL_ACCESS_TOKEN: "secret-value" }, fetchImpl });
  assert.equal(result.find((item) => item.id === "gmail").ok, true);
  assert.deepEqual(calls, [{ url: "https://gmail.googleapis.com/gmail/v1/users/me/profile", method: "GET" }]);
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("NetSuite sync reads SuiteQL and normalizes records", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ items: [{ id: 42, tranid: "SO42", entity: 7, otherrefnum: "PO42", location: 3, shipdate: "2026-08-20", status: "Open" }] }), { status: 200 });
  };
  const orders = await fetchNetSuiteOrders({ env: { NETSUITE_BASE_URL: "https://acct.example", NETSUITE_ACCESS_TOKEN: "secret-value" }, fetchImpl, limit: 25 });
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.prefer, "transient");
  assert.equal(orders[0].netSuiteId, "SO42");
  assert.equal(orders[0].poNumber, "PO42");
});

test("discovers STORD MCP OAuth metadata without credentials", async () => {
  const fetchImpl = async (url) => new Response(JSON.stringify(url.includes("oauth-protected-resource") ? { authorization_servers: ["https://auth.stord.test"] } : { authorization_endpoint: "https://auth.stord.test/authorize", token_endpoint: "https://auth.stord.test/token", registration_endpoint: "https://auth.stord.test/register", grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"] }), { status: 200 });
  const result = await discoverStordMcp({ fetchImpl, mcpUrl: "https://gateway.stord.test/mcp" });
  assert.equal(result.oauth.authorization_endpoint, "https://auth.stord.test/authorize");
});

test("initializes the official STORD MCP with a bearer token", async () => {
  let request;
  const fetchImpl = async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "stord" } } }), { status: 200 }); };
  const result = await probeStordMcp({ env: { STORD_MCP_URL: "https://gateway.stord.test/mcp", STORD_MCP_ACCESS_TOKEN: "secret-value" }, fetchImpl });
  assert.equal(result.serverInfo.name, "stord");
  assert.equal(request.options.method, "POST");
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});
