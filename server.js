import "dotenv/config";
import express from "express";
import cors from "cors";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import Ajv from "ajv";
import { kv } from "@vercel/kv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isVercel = !!process.env.VERCEL;
const useKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const PORT = process.env.PORT || 3000;
const ACTION_API_KEY = process.env.ACTION_API_KEY || "change_this_to_a_secret_key";
const SCHEMA_FILE = resolve(__dirname, "schemas", "wildlife-package.schema.json");

// KV key namespace
const KV_LATEST = "wildlife:packages:latest";
const KV_INDEX = "wildlife:packages:index";
const kvKey = (id) => `wildlife:packages:${id}`;

// ---- Local filesystem fallback (dev only) ----
const DATA_DIR = resolve(__dirname, "data");
const PACKAGES_FILE = resolve(DATA_DIR, "packages.json");

if (!useKV) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(PACKAGES_FILE)) writeFileSync(PACKAGES_FILE, "[]", "utf8");
}

function loadPackagesFs() {
  return JSON.parse(readFileSync(PACKAGES_FILE, "utf8"));
}

function savePackagesFs(packages) {
  writeFileSync(PACKAGES_FILE, JSON.stringify(packages, null, 2), "utf8");
}

// ---- KV helpers ----
async function savePackageKv(record) {
  await kv.set(kvKey(record.id), JSON.stringify(record));
  await kv.set(KV_LATEST, record.id);
  await kv.lpush(KV_INDEX, record.id);
}

async function getLatestPackageKv() {
  const id = await kv.get(KV_LATEST);
  if (!id) return null;
  const raw = await kv.get(kvKey(id));
  return raw ? JSON.parse(raw) : null;
}

async function getAllPackagesKv() {
  const ids = await kv.lrange(KV_INDEX, 0, -1);
  const items = [];
  for (const id of ids) {
    const raw = await kv.get(kvKey(id));
    if (raw) items.push(JSON.parse(raw));
  }
  return items;
}

// ---- Load schema & init AJV ----
const schemaRaw = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));
delete schemaRaw.$schema;
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schemaRaw);

// ---- Express app ----
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Static frontend
const INDEX_HTML = readFileSync(resolve(__dirname, "index.html"), "utf8");
const SAMPLE_JSON = readFileSync(resolve(__dirname, "examples", "sample-output.json"), "utf8");

app.get("/", (_req, res) => { res.type("html").send(INDEX_HTML); });
app.get("/examples/sample-output.json", (_req, res) => { res.type("json").send(SAMPLE_JSON); });

// ---- Health ----
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "wildlife-documentary-engine",
    mode: "custom-gpt-action-storage",
    status: "ready",
    storage: useKV ? "vercel-kv" : "local-filesystem"
  });
});

// ---- Auth middleware ----
function requireApiKey(req, res, next) {
  const key = req.headers["x-action-api-key"];
  if (!key || key !== ACTION_API_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// ---- Save package ----
app.post("/api/packages", requireApiKey, async (req, res) => {
  const pkg = req.body;

  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return res.status(400).json({ ok: false, message: "Request body must be a JSON object." });
  }

  const valid = validate(pkg);
  if (!valid) {
    const errors = (validate.errors || []).map(e => ({
      path: e.instancePath || "/",
      message: e.message,
      params: e.params
    }));
    return res.status(400).json({
      ok: false,
      message: "JSON does not match the Wildlife Documentary schema.",
      errors
    });
  }

  const record = {
    id: `pkg_${Date.now()}_${nanoid(8)}`,
    createdAt: new Date().toISOString(),
    package: pkg
  };

  try {
    if (useKV) {
      await savePackageKv(record);
    } else {
      const packages = loadPackagesFs();
      packages.push(record);
      savePackagesFs(packages);
    }
    res.status(201).json({ ok: true, ...record });
  } catch (err) {
    console.error("Save failed:", err);
    res.status(500).json({ ok: false, message: "Failed to save package." });
  }
});

// ---- Get latest package ----
app.get("/api/packages/latest", async (_req, res) => {
  try {
    let latest;
    if (useKV) {
      latest = await getLatestPackageKv();
    } else {
      const packages = loadPackagesFs();
      latest = packages.length > 0 ? packages[packages.length - 1] : null;
    }

    if (!latest) {
      return res.status(404).json({ ok: false, message: "No saved packages yet." });
    }
    res.json({ ok: true, ...latest });
  } catch (err) {
    console.error("Load latest failed:", err);
    res.status(500).json({ ok: false, message: "Failed to load package." });
  }
});

// ---- List all packages ----
app.get("/api/packages", async (_req, res) => {
  try {
    const items = useKV ? await getAllPackagesKv() : loadPackagesFs();
    res.json({ ok: true, items });
  } catch (err) {
    console.error("List packages failed:", err);
    res.status(500).json({ ok: false, message: "Failed to list packages." });
  }
});

// ---- Start (local only) ----
if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`Wildlife Documentary Engine running on http://localhost:${PORT}`);
    console.log(`Storage: ${useKV ? "Vercel KV" : "local filesystem"}`);
  });
}

export default app;
