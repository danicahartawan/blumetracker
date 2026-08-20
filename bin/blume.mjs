#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { runOrders } from "./blume-orders.mjs";

const exec = promisify(execFile);
const args = process.argv.slice(2);
const command = args[0];

function option(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function projectConfig(directory) {
  try {
    return JSON.parse(await readFile(path.join(directory, "blume.json"), "utf8"));
  } catch {
    try {
      const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      return { name: pkg.name };
    } catch {
      return {};
    }
  }
}

async function deploy() {
  const directory = path.resolve(option("--dir", process.cwd()));
  const config = await projectConfig(directory);
  const name = option("--name", config.name);
  const endpoint = option("--endpoint", process.env.BLUME_ENDPOINT || config.endpoint || "http://localhost:8787").replace(/\/$/, "");
  const token = option("--token", process.env.BLUME_TOKEN || "blume-local");
  const healthPath = option("--health", config.healthPath || "/health");
  if (!name) throw new Error("Set a name in blume.json, package.json, or --name.");
  try { await readFile(path.join(directory, "Dockerfile")); } catch { throw new Error("A Dockerfile is required at the project root."); }

  let revision = "local";
  try { revision = (await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: directory })).stdout.trim(); } catch {}
  const temporary = await mkdtemp(path.join(os.tmpdir(), "blume-deploy-"));
  const archive = path.join(temporary, "source.tar.gz");
  process.stdout.write(`Packing ${name}... `);
  const tarArgs = ["-czf", archive, "--exclude=.git", "--exclude=node_modules", "--exclude=.blume-data"];
  try {
    await readFile(path.join(directory, ".blumeignore"));
    tarArgs.push("--exclude-from=.blumeignore");
  } catch {}
  tarArgs.push("-C", directory, ".");
  await exec("tar", tarArgs, { cwd: directory });
  console.log("done");

  try {
    process.stdout.write(`Uploading to ${endpoint}... `);
    const response = await fetch(`${endpoint}/api/deployments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/gzip",
        "x-blume-app-name": name,
        "x-blume-app-slug": option("--slug", config.slug || name),
        "x-blume-revision": revision,
        "x-blume-health-path": healthPath,
      },
      body: createReadStream(archive),
      duplex: "half",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);
    console.log(`queued as ${result.deployment.id}`);

    let deployment = result.deployment;
    let lastStatus = "queued";
    while (!["healthy", "failed"].includes(deployment.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const statusResponse = await fetch(`${endpoint}/api/deployments/${deployment.id}`, { headers: { authorization: `Bearer ${token}` } });
      ({ deployment } = await statusResponse.json());
      if (deployment.status !== lastStatus) {
        console.log(`  ${deployment.status}`);
        lastStatus = deployment.status;
      }
    }
    if (deployment.status === "failed") throw new Error(`Deployment failed: ${deployment.error}\n\n${deployment.logs || ""}`);
    console.log(`Live: ${endpoint}${deployment.url}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (command === "orders") {
  runOrders(args.slice(1)).catch((error) => { console.error(`\nBlume orders error: ${error.message}`); process.exitCode = 1; });
} else if (command === "deploy") {
  deploy().catch((error) => { console.error(`\nBlume deploy error: ${error.message}`); process.exitCode = 1; });
} else {
  console.log("Usage: blume deploy [...] | blume orders <connections|plan|tasks|complete> [...]");
}
