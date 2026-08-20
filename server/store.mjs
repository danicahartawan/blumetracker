import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDirectory = path.resolve(process.env.BLUME_DATA_DIR || ".blume-data");
const statePath = path.join(dataDirectory, "state.json");
let updateQueue = Promise.resolve();

const emptyState = () => ({ version: 1, apps: [], deployments: [], events: [] });

export async function ensureStore() {
  await mkdir(path.join(dataDirectory, "artifacts"), { recursive: true });
  await mkdir(path.join(dataDirectory, "work"), { recursive: true });
  try {
    await readFile(statePath, "utf8");
  } catch {
    await saveState(emptyState());
  }
}

export async function loadState() {
  await ensureStore();
  return JSON.parse(await readFile(statePath, "utf8"));
}

export async function saveState(state) {
  await mkdir(dataDirectory, { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporaryPath, statePath);
}

export async function updateState(mutator) {
  const operation = updateQueue.then(async () => {
    const state = await loadState();
    const result = await mutator(state);
    await saveState(state);
    return result;
  });
  updateQueue = operation.catch(() => {});
  return operation;
}

export function dataPath(...parts) {
  return path.join(dataDirectory, ...parts);
}
