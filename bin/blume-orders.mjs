#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyExternalEvent, completeTask, planOrder, readJson, writeJson } from "../lib/order-workflow.mjs";
import { connectionConfiguration, discoverStordMcp, fetchNetSuiteOrders, probeConnections } from "../server/order-connectors.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function usage() {
  console.log(`Usage:
  blume orders connections [--json]
  blume orders doctor [--live] [--json]
  blume orders sync-netsuite --out ORDERS.json [--limit 100]
  blume orders stord-discover [--json]
  blume orders plan --input ORDER.json [--out STATE.json]
  blume orders tasks --state STATE.json
  blume orders complete --state STATE.json --task TASK_ID --actor NAME --evidence PATH_OR_URL --confirm
  blume orders event --state STATE.json --source netsuite|stord_s1c --type EVENT --event-id ID --confirm`);
}

export async function runOrders(args) {
  const command = args[0];
  if (command === "connections") {
    const manifest = await readJson(path.join(root, "workflow/connections.json"));
    const result = manifest.connections.map((connection) => ({
      ...connection,
      configured: connection.credentials.every((name) => Boolean(process.env[name]))
    }));
    if (args.includes("--json")) return console.log(JSON.stringify(result, null, 2));
    console.table(result.map(({ id, purpose, preferred, status, configured }) => ({ id, configured, status, purpose, preferred })));
    return;
  }
  if (command === "doctor") {
    const result = args.includes("--live") ? await probeConnections() : connectionConfiguration();
    if (args.includes("--json")) return console.log(JSON.stringify(result, null, 2));
    console.table(result.map(({ id, configured, ok, live, missing, detail }) => ({ id, configured, live: live ?? false, ok: ok ?? "—", missing: (missing || []).join(", "), detail: detail || "" })));
    return;
  }
  if (command === "sync-netsuite") {
    const out = option(args, "--out");
    if (!out) throw new Error("--out is required");
    const orders = await fetchNetSuiteOrders({ limit: option(args, "--limit", 100) });
    await writeJson(path.resolve(out), { syncedAt: new Date().toISOString(), source: "netsuite", count: orders.length, orders });
    console.log(`Read ${orders.length} NetSuite order(s) into ${path.resolve(out)}. No NetSuite records were changed.`);
    return;
  }
  if (command === "stord-discover") {
    const result = await discoverStordMcp({ mcpUrl: process.env.STORD_MCP_URL || "https://gateway.stord.com/mcp" });
    const safe = { mcpUrl: result.mcpUrl, authorizationServer: result.protectedResource.authorization_servers?.[0], authorizationEndpoint: result.oauth.authorization_endpoint, tokenEndpoint: result.oauth.token_endpoint, registrationEndpoint: result.oauth.registration_endpoint, grants: result.oauth.grant_types_supported, pkce: result.oauth.code_challenge_methods_supported };
    if (args.includes("--json")) console.log(JSON.stringify(safe, null, 2));
    else console.table([safe]);
    return;
  }
  if (command === "plan") {
    const inputFile = option(args, "--input");
    if (!inputFile) throw new Error("--input is required");
    const state = planOrder(await readJson(path.resolve(inputFile)));
    const out = option(args, "--out");
    if (out) {
      await writeJson(path.resolve(out), state);
      console.log(`Wrote ${state.tasks.length} task(s) to ${path.resolve(out)}`);
    } else console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (command === "tasks") {
    const stateFile = option(args, "--state");
    if (!stateFile) throw new Error("--state is required");
    const state = await readJson(path.resolve(stateFile));
    console.table(state.tasks.map(({ id, ownerRole, status, externalSystem, reason }) => ({ id, ownerRole, status, externalSystem, reason })));
    return;
  }
  if (command === "complete") {
    const stateFile = option(args, "--state");
    if (!stateFile) throw new Error("--state is required");
    const state = completeTask(await readJson(path.resolve(stateFile)), option(args, "--task"), {
      actor: option(args, "--actor"), evidence: option(args, "--evidence"), confirm: args.includes("--confirm")
    });
    await writeJson(path.resolve(stateFile), state);
    console.log(`Completed ${option(args, "--task")}; audit evidence recorded.`);
    return;
  }
  if (command === "event") {
    const stateFile = option(args, "--state");
    if (!stateFile) throw new Error("--state is required");
    const state = applyExternalEvent(await readJson(path.resolve(stateFile)), {
      source: option(args, "--source"), type: option(args, "--type"), eventId: option(args, "--event-id"), at: option(args, "--at")
    }, { confirm: args.includes("--confirm") });
    await writeJson(path.resolve(stateFile), state);
    console.log(`${state.workflowStatus}; source evidence ${state.statusEvidence} recorded.`);
    return;
  }
  usage();
  if (command) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runOrders(process.argv.slice(2)).catch((error) => { console.error(`Blume orders error: ${error.message}`); process.exitCode = 1; });
}
