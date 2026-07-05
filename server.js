import "dotenv/config";
import express from "express";
import cors from "cors";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isVercel = !!process.env.VERCEL;
const PORT = process.env.PORT || 3000;
const ACTION_API_KEY = process.env.ACTION_API_KEY || "change_this_to_a_secret_key";
const DATA_DIR = isVercel ? "/tmp" : resolve(__dirname, "data");
const PACKAGES_FILE = resolve(DATA_DIR, "packages.json");
const SCHEMA_FILE = resolve(__dirname, "schemas", "wildlife-package.schema.json");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(PACKAGES_FILE)) writeFileSync(PACKAGES_FILE, "[]", "utf8");

// Load schema & init AJV (strip $schema — AJV doesn't need draft-2020-12 meta)
const schemaRaw = JSON.parse(readFileSync(SCHEMA_FILE, "utf8"));
delete schemaRaw.$schema;
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schemaRaw);

function loadPackages() {
  const raw = readFileSync(PACKAGES_FILE, "utf8");
  return JSON.parse(raw);
}

function savePackages(packages) {
  writeFileSync(PACKAGES_FILE, JSON.stringify(packages, null, 2), "utf8");
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve static frontend
app.use(express.static(__dirname));

// ---- Health ----
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "wildlife-documentary-engine",
    mode: "custom-gpt-action-storage",
    status: "ready"
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
app.post("/api/packages", requireApiKey, (req, res) => {
  const pkg = req.body;

  // Validate body is an object
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return res.status(400).json({ ok: false, message: "Request body must be a JSON object." });
  }

  // Validate against schema (strip extra fields, don't reject — just warn)
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

  const packages = loadPackages();
  packages.push(record);
  savePackages(packages);

  res.status(201).json({ ok: true, ...record });
});

// ---- Get latest package ----
app.get("/api/packages/latest", (_req, res) => {
  const packages = loadPackages();
  if (packages.length === 0) {
    return res.status(404).json({ ok: false, message: "No saved packages yet." });
  }
  const latest = packages[packages.length - 1];
  res.json({ ok: true, ...latest });
});

// ---- List all packages ----
app.get("/api/packages", (_req, res) => {
  const packages = loadPackages();
  res.json({ ok: true, items: packages });
});

if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`Wildlife Documentary Engine running on http://localhost:${PORT}`);
  });
}

export default app;
