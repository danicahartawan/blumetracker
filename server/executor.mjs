import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { dataPath, updateState } from "./store.mjs";

const exec = promisify(execFile);
const activePorts = new Map();

function logLimit(value) {
  return String(value || "").slice(-12000);
}

async function setDeployment(id, patch, event) {
  await updateState((state) => {
    const deployment = state.deployments.find((item) => item.id === id);
    if (!deployment) return;
    Object.assign(deployment, patch, { updatedAt: new Date().toISOString() });
    if (event) {
      state.events.unshift({ id: crypto.randomUUID(), deploymentId: id, createdAt: new Date().toISOString(), ...event });
      state.events = state.events.slice(0, 300);
    }
    const app = state.apps.find((item) => item.id === deployment.appId);
    if (app) {
      app.status = deployment.status;
      app.updatedAt = deployment.updatedAt;
      if (deployment.status === "healthy") app.liveDeploymentId = id;
    }
  });
}

async function validateArchive(archivePath) {
  const { stdout } = await exec("tar", ["-tzf", archivePath], { maxBuffer: 4 * 1024 * 1024 });
  const entries = stdout.split("\n").filter(Boolean);
  if (!entries.length) throw new Error("The uploaded archive is empty.");
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) {
      throw new Error(`Unsafe archive entry: ${entry}`);
    }
  }
}

async function healthCheck(port, healthPath) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const request = http.get({ hostname: "127.0.0.1", port, path: healthPath, timeout: 1500 }, (response) => {
        response.resume();
        resolve(response.statusCode >= 200 && response.statusCode < 400);
      });
      request.on("timeout", () => request.destroy());
      request.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Health check ${healthPath} did not pass within 45 seconds.`);
}

async function nextPort() {
  const { stdout } = await exec(process.execPath, ["-e", "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"]);
  return Number(stdout.trim());
}

export async function executeDeployment(deployment) {
  const workDirectory = dataPath("work", deployment.id);
  const image = `blume-${deployment.appSlug}:${deployment.id}`.toLowerCase();
  let logs = "";
  try {
    await setDeployment(deployment.id, { status: "building" }, { type: "build.started", message: "Build started" });
    await rm(workDirectory, { recursive: true, force: true });
    await mkdir(workDirectory, { recursive: true });
    await validateArchive(deployment.artifactPath);
    await exec("tar", ["-xzf", deployment.artifactPath, "-C", workDirectory]);
    await readFile(path.join(workDirectory, "Dockerfile"));

    const build = await exec("docker", ["build", "--tag", image, "."], {
      cwd: workDirectory,
      maxBuffer: 12 * 1024 * 1024,
      env: { ...process.env, DOCKER_BUILDKIT: "1" },
    });
    logs += `${build.stdout}\n${build.stderr}`;

    await setDeployment(deployment.id, { status: "deploying", logs: logLimit(logs) }, { type: "deploy.started", message: "Container starting" });
    const port = await nextPort();
    const containerName = `blume-${deployment.appSlug}-${deployment.id}`.toLowerCase();
    const previous = [...activePorts.entries()].find(([, value]) => value.appId === deployment.appId);
    const run = await exec("docker", [
      "run", "--detach", "--name", containerName,
      "--label", `dev.blume.app=${deployment.appId}`,
      "--label", `dev.blume.deployment=${deployment.id}`,
      "--publish", `127.0.0.1:${port}:8080`,
      "--env", "PORT=8080", image,
    ]);
    logs += `\n${run.stdout}\n${run.stderr}`;
    await healthCheck(port, deployment.healthPath);
    activePorts.set(deployment.appSlug, { port, containerName, appId: deployment.appId });

    await setDeployment(deployment.id, {
      status: "healthy", port, containerName, image, logs: logLimit(logs),
      url: `/apps/${deployment.appSlug}/`, finishedAt: new Date().toISOString(),
    }, { type: "deploy.healthy", message: "Deployment is healthy" });

    if (previous && previous[1].containerName !== containerName) {
      exec("docker", ["rm", "--force", previous[1].containerName]).catch(() => {});
    }
  } catch (error) {
    if (error.code === "ENOENT" && error.path === "docker") {
      error.message = "Docker is not installed on the Blume control-plane host. Install Docker and retry the deployment.";
    }
    logs += `\n${error.stderr || ""}\n${error.stdout || ""}\n${error.message}`;
    await setDeployment(deployment.id, { status: "failed", logs: logLimit(logs), error: error.message }, { type: "deploy.failed", message: error.message });
  }
}

export function runtimeFor(slug) {
  return activePorts.get(slug);
}

export async function restoreRuntimes() {
  try {
    const { stdout } = await exec("docker", ["ps", "--filter", "label=dev.blume.app", "--format", "{{.Names}}\t{{.Label \"dev.blume.app\"}}\t{{.Ports}}"]);
    for (const line of stdout.trim().split("\n").filter(Boolean)) {
      const [containerName, appId, ports] = line.split("\t");
      const match = ports.match(/127\.0\.0\.1:(\d+)->8080/);
      if (!match) continue;
      const state = await (await import("./store.mjs")).loadState();
      const app = state.apps.find((item) => item.id === appId);
      if (app) activePorts.set(app.slug, { containerName, appId, port: Number(match[1]) });
    }
  } catch {
    // Docker may not be available until the first deployment attempt.
  }
}

export async function writeRequestBody(request, destination, maximumBytes = 100 * 1024 * 1024) {
  await mkdir(path.dirname(destination), { recursive: true });
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const stream = createWriteStream(destination, { flags: "wx" });
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maximumBytes) request.destroy(new Error("Artifact exceeds the 100 MB limit."));
    });
    request.pipe(stream);
    stream.on("finish", () => resolve(bytes));
    stream.on("error", reject);
    request.on("error", reject);
  });
}
