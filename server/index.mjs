import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { executeDeployment, restoreRuntimes, runtimeFor, writeRequestBody } from "./executor.mjs";
import { dataPath, ensureStore, loadState, updateState } from "./store.mjs";
import { connectionConfiguration, fetchNetSuiteOrders, probeConnections } from "./order-connectors.mjs";
import { analyzeOrder, findOrder, refreshOrderStatuses } from "./order-agent.mjs";
import { parsePdfOrder, parseXlsxOrders, readImportBody } from "./order-import.mjs";
import { scanGmailOrders } from "./gmail-order-intake.mjs";

const port = Number(process.env.PORT || process.env.BLUME_PORT || 8787);
const authMode = process.env.BLUME_AUTH_MODE || "token";
const token = process.env.BLUME_API_TOKEN || "";
const host = authMode === "local" ? "127.0.0.1" : "0.0.0.0";
const webRoot = path.resolve(process.env.BLUME_WEB_ROOT || "dist/client");

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function authorized(request) {
  if (authMode === "local") return request.socket.remoteAddress === "127.0.0.1" || request.socket.remoteAddress === "::1" || request.socket.remoteAddress === "::ffff:127.0.0.1";
  return request.headers.authorization === `Bearer ${token}`;
}

async function readJson(request, maxBytes = 32_768) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("invalid_json"); }
}

function slugify(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

async function proxyApp(request, response, slug, remainder) {
  const runtime = runtimeFor(slug);
  if (!runtime) return json(response, 503, { error: "app_not_running" });
  const headers = { ...request.headers, host: `127.0.0.1:${runtime.port}`, "x-blume-app": slug };
  const proxy = http.request({ hostname: "127.0.0.1", port: runtime.port, path: remainder || "/", method: request.method, headers }, (upstream) => {
    response.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(response);
  });
  proxy.on("error", (error) => json(response, 502, { error: error.message }));
  request.pipe(proxy);
}

async function serveWeb(response, pathname) {
  const candidate = pathname.startsWith("/assets/") ? path.join(webRoot, pathname) : path.join(webRoot, "index.html");
  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("not a file");
    const extension = path.extname(candidate);
    const type = extension === ".js" ? "text/javascript" : extension === ".css" ? "text/css" : extension === ".svg" ? "image/svg+xml" : "text/html";
    response.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    createReadStream(candidate).pipe(response);
  } catch {
    json(response, 404, { error: "not_found" });
  }
}

await ensureStore();
await restoreRuntimes();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname === "/health") return json(response, 200, { ok: true });

    const appMatch = url.pathname.match(/^\/apps\/([^/]+)(\/.*)?$/);
    if (appMatch) return proxyApp(request, response, appMatch[1], `${appMatch[2] || "/"}${url.search}`);

    if (url.pathname === "/api/apps" && request.method === "GET") {
      const state = await loadState();
      return json(response, 200, { apps: state.apps, deployments: state.deployments.slice(0, 50), events: state.events.slice(0, 50) });
    }

    if (url.pathname.startsWith("/api/") && !authorized(request)) return json(response, 401, { error: "unauthorized" });

    if (url.pathname === "/api/order-connections" && request.method === "GET") {
      const connections = url.searchParams.get("live") === "true" ? await probeConnections() : connectionConfiguration();
      return json(response, 200, { connections });
    }

    if (url.pathname === "/api/orders" && request.method === "GET") {
      const state = await loadState();
      return json(response, 200, { orders: state.orders || [], orderSync: state.orderSync || null });
    }

    if (url.pathname === "/api/orders/import" && request.method === "POST") {
      const filename = path.basename(decodeURIComponent(String(request.headers["x-file-name"] || "order.xlsx")));
      const extension = path.extname(filename).toLowerCase();
      const orderType = ["sample_d2c", "b2b_wholesale", "direct_netsuite"].includes(String(request.headers["x-order-type"])) ? String(request.headers["x-order-type"]) : "direct_netsuite";
      if (![".xlsx", ".xls", ".pdf"].includes(extension)) return json(response, 400, { error: "Choose an XLSX, XLS, or PDF file." });
      const buffer = await readImportBody(request);
      const imported = extension === ".pdf" ? await parsePdfOrder(buffer, { orderType }) : parseXlsxOrders(buffer, { orderType });
      const importedAt = new Date().toISOString();
      const result = await updateState((state) => {
        state.orders ||= [];
        const existingKeys = new Set(state.orders.flatMap((order) => [order.netSuiteId, order.poNumber].filter(Boolean).map((item) => String(item).toLowerCase())));
        const added = imported.filter((order) => ![order.netSuiteId, order.poNumber].filter(Boolean).some((item) => existingKeys.has(String(item).toLowerCase())));
        state.orders.push(...added);
        state.orderSync = { source: extension === ".pdf" ? "pdf" : "xlsx", fileName: filename, readOnly: false, count: added.length, skipped: imported.length - added.length, syncedAt: importedAt };
        return { orders: state.orders, imported: added, skipped: imported.length - added.length, orderSync: state.orderSync };
      });
      return json(response, 201, result);
    }

    if (url.pathname === "/api/orders/intake/gmail" && request.method === "POST") {
      const intake = await scanGmailOrders({ limit: Number(url.searchParams.get("limit") || 25) });
      const syncedAt = new Date().toISOString();
      const result = await updateState((state) => {
        state.orders ||= [];
        const existingMessages = new Set(state.orders.map((order) => order.gmailMessageId).filter(Boolean));
        const existingKeys = new Set(state.orders.flatMap((order) => [order.netSuiteId, order.poNumber].filter(Boolean).map((item) => String(item).toLowerCase())));
        const added = intake.orders.filter((order) => !existingMessages.has(order.gmailMessageId) && ![order.netSuiteId, order.poNumber].filter(Boolean).some((item) => existingKeys.has(String(item).toLowerCase())));
        state.orders.push(...added);
        state.orderSync = { source: "gmail", fileName: "Nevan's inbox", count: added.length, scanned: intake.scanned, skipped: intake.orders.length - added.length, syncedAt };
        return { orders: state.orders, imported: added, scanned: intake.scanned, skipped: intake.orders.length - added.length, orderSync: state.orderSync };
      });
      return json(response, 200, result);
    }

    if (url.pathname === "/api/orders/refresh" && request.method === "POST") {
      const state = await loadState();
      const result = await refreshOrderStatuses({ currentOrders: state.orders || [], limit: Number(url.searchParams.get("limit") || 100) });
      await updateState((next) => { next.orders = result.orders; next.orderSync = result.orderSync; });
      return json(response, 200, result);
    }

    const orderAgentMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/agent$/);
    if (orderAgentMatch && request.method === "POST") {
      const body = await readJson(request);
      const state = await loadState();
      const order = findOrder(state.orders || [], decodeURIComponent(orderAgentMatch[1]));
      if (!order) return json(response, 404, { error: "order_not_found" });
      return json(response, 200, { agent: analyzeOrder(order, { prompt: String(body.prompt || "").slice(0, 2000) }) });
    }

    if (url.pathname === "/api/orders/sync/netsuite" && request.method === "POST") {
      const state = await loadState();
      const result = await refreshOrderStatuses({ currentOrders: state.orders || [], limit: Number(url.searchParams.get("limit") || 100) });
      await updateState((next) => { next.orders = result.orders; next.orderSync = result.orderSync; });
      return json(response, 200, result);
    }

    if (url.pathname === "/api/deployments" && request.method === "POST") {
      const name = String(request.headers["x-blume-app-name"] || "").trim().slice(0, 80);
      const slug = slugify(request.headers["x-blume-app-slug"] || name);
      const revision = String(request.headers["x-blume-revision"] || "local").slice(0, 80);
      const healthPath = String(request.headers["x-blume-health-path"] || "/health");
      if (!name || !slug) return json(response, 400, { error: "App name and slug are required." });
      if (!healthPath.startsWith("/")) return json(response, 400, { error: "Health path must begin with /." });

      const deploymentId = crypto.randomUUID().split("-")[0];
      const artifactPath = dataPath("artifacts", `${deploymentId}.tar.gz`);
      const bytes = await writeRequestBody(request, artifactPath);
      const now = new Date().toISOString();
      const deployment = await updateState((state) => {
        let app = state.apps.find((item) => item.slug === slug);
        if (!app) {
          app = { id: crypto.randomUUID(), name, slug, status: "queued", createdAt: now, updatedAt: now };
          state.apps.push(app);
        }
        const item = { id: deploymentId, appId: app.id, appName: name, appSlug: slug, revision, healthPath, artifactPath, artifactBytes: bytes, status: "queued", createdAt: now, updatedAt: now };
        state.deployments.unshift(item);
        state.events.unshift({ id: crypto.randomUUID(), deploymentId, type: "deploy.queued", message: "Artifact received", createdAt: now });
        app.status = "queued";
        app.updatedAt = now;
        return item;
      });
      json(response, 202, { deployment });
      setImmediate(() => executeDeployment(deployment));
      return;
    }

    const deploymentMatch = url.pathname.match(/^\/api\/deployments\/([^/]+)$/);
    if (deploymentMatch && request.method === "GET") {
      const state = await loadState();
      const deployment = state.deployments.find((item) => item.id === deploymentMatch[1]);
      return deployment ? json(response, 200, { deployment }) : json(response, 404, { error: "not_found" });
    }

    return serveWeb(response, url.pathname);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: error.message || "internal_error" });
    else response.end();
  }
});

if (authMode !== "local" && !token) throw new Error("BLUME_API_TOKEN is required unless BLUME_AUTH_MODE=local");

server.listen(port, host, () => {
  console.log(`Blume control plane listening on http://${host}:${port}`);
  if (authMode === "local") console.log("Local-only authentication mode: API accepts loopback requests without a Blume token.");
});
