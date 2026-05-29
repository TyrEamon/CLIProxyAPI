#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const process = require("node:process");
const { Readable } = require("node:stream");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BIN_DIR = path.join(ROOT, "bin");
const DEFAULT_RELEASE_REPO = "router-for-me/CLIProxyAPI";
const BINARY_NAME = process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
const BINARY_PATH = path.join(BIN_DIR, BINARY_NAME);

function log(message) {
  console.log(`[galaxy-start] ${message}`);
}

function warn(message) {
  console.warn(`[galaxy-start] ${message}`);
}

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return defaultValue;
  }
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function splitList(raw) {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function renderList(key, values) {
  if (!values.length) {
    return `${key}: []`;
  }
  return `${key}:\n${values.map((value) => `  - ${yamlString(value)}`).join("\n")}`;
}

function renderGeneratedConfig({ port, authDir, apiKeys, allowRemoteManagement }) {
  return [
    'host: ""',
    `port: ${port}`,
    `auth-dir: ${yamlString(authDir)}`,
    renderList("api-keys", apiKeys),
    "remote-management:",
    `  allow-remote: ${allowRemoteManagement ? "true" : "false"}`,
    '  secret-key: ""',
    "logging-to-file: false",
    "usage-statistics-enabled: false",
    "",
  ].join("\n");
}

function upsertTopLevelScalar(yaml, key, value) {
  const line = `${key}: ${value}`;
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:.*$`, "m");
  if (pattern.test(yaml)) {
    return yaml.replace(pattern, line);
  }
  return `${line}\n${yaml}`;
}

function upsertTopLevelList(yaml, key, values) {
  if (!values.length) {
    return yaml;
  }

  const block = renderList(key, values).split("\n");
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `${key}:` || line.startsWith(`${key}: `));

  if (start === -1) {
    if (yaml.endsWith("\n")) {
      return `${yaml}${block.join("\n")}\n`;
    }
    return `${yaml}\n${block.join("\n")}\n`;
  }

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === "" || line.startsWith(" ") || line.startsWith("\t") || line.trim().startsWith("- ")) {
      end++;
      continue;
    }
    break;
  }

  lines.splice(start, end - start, ...block);
  return lines.join("\n");
}

function upsertRemoteAllow(yaml, allowRemoteManagement) {
  if (!envFlag("ALLOW_REMOTE_MANAGEMENT", false)) {
    return yaml;
  }

  const value = allowRemoteManagement ? "true" : "false";
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "remote-management:");
  if (start === -1) {
    return `${yaml.replace(/\s*$/, "\n")}remote-management:\n  allow-remote: ${value}\n`;
  }

  let end = start + 1;
  let allowIndex = -1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() !== "" && !line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }
    if (/^\s+allow-remote:/.test(line)) {
      allowIndex = end;
    }
    end++;
  }

  if (allowIndex !== -1) {
    lines[allowIndex] = `  allow-remote: ${value}`;
  } else {
    lines.splice(start + 1, 0, `  allow-remote: ${value}`);
  }
  return lines.join("\n");
}

function ensureConfig() {
  const port = Number.parseInt(process.env.PORT || process.env.CLIPROXY_PORT || "8317", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid PORT value: ${process.env.PORT || process.env.CLIPROXY_PORT}`);
  }

  const configPath = path.resolve(ROOT, process.env.CLIPROXY_CONFIG_PATH || "config.yaml");
  const authDir = process.env.CLIPROXY_AUTH_DIR || "auths";
  const apiKeys = splitList(process.env.API_KEYS || process.env.CLIPROXY_API_KEYS);
  const allowRemoteManagement = envFlag("ALLOW_REMOTE_MANAGEMENT", Boolean(process.env.MANAGEMENT_PASSWORD));

  let yaml;
  if (process.env.CLIPROXY_CONFIG_BASE64) {
    yaml = Buffer.from(process.env.CLIPROXY_CONFIG_BASE64, "base64").toString("utf8");
  } else if (process.env.CLIPROXY_CONFIG_YAML) {
    yaml = process.env.CLIPROXY_CONFIG_YAML;
  } else if (fs.existsSync(configPath)) {
    yaml = fs.readFileSync(configPath, "utf8");
  } else {
    yaml = renderGeneratedConfig({ port, authDir, apiKeys, allowRemoteManagement });
  }

  yaml = upsertTopLevelScalar(yaml, "port", String(port));
  if (!/^\s*auth-dir:/m.test(yaml)) {
    yaml = upsertTopLevelScalar(yaml, "auth-dir", yamlString(authDir));
  }
  yaml = upsertTopLevelList(yaml, "api-keys", apiKeys);
  yaml = upsertRemoteAllow(yaml, allowRemoteManagement);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.endsWith("\n") ? yaml : `${yaml}\n`);

  if (!apiKeys.length && !/^\s*api-keys:\s*\n\s*-/m.test(yaml)) {
    warn("no API_KEYS/CLIPROXY_API_KEYS configured; API routes may be unauthenticated.");
  }

  log(`using config ${path.relative(ROOT, configPath)} on port ${port}`);
  return configPath;
}

function platformAssetName(version) {
  if (process.platform !== "linux") {
    throw new Error(`Galaxy launcher downloads Linux releases only; current platform is ${process.platform}`);
  }

  const archMap = {
    x64: "amd64",
    arm64: "aarch64",
  };
  const releaseArch = archMap[process.arch];
  if (!releaseArch) {
    throw new Error(`unsupported CPU architecture: ${process.arch}`);
  }

  const cleanVersion = version.replace(/^v/i, "");
  return `CLIProxyAPI_${cleanVersion}_linux_${releaseArch}.tar.gz`;
}

async function githubJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "cliproxyapi-galaxy-launcher",
      "Accept": "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function resolveDownload() {
  if (process.env.CLIPROXY_BINARY_URL) {
    return {
      url: process.env.CLIPROXY_BINARY_URL,
      version: "custom",
      assetName: path.basename(new URL(process.env.CLIPROXY_BINARY_URL).pathname),
    };
  }

  const repo = process.env.CLIPROXY_RELEASE_REPO || DEFAULT_RELEASE_REPO;
  const version = process.env.CLIPROXY_VERSION;
  const apiUrl = version
    ? `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(version)}`
    : `https://api.github.com/repos/${repo}/releases/latest`;
  const release = await githubJson(apiUrl);
  const tag = release.tag_name || version;
  const assetName = platformAssetName(tag);
  const asset = (release.assets || []).find((item) => item.name === assetName);
  if (!asset) {
    throw new Error(`release ${tag} does not contain ${assetName}`);
  }

  return { url: asset.browser_download_url, version: tag, assetName };
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: { "User-Agent": "cliproxyapi-galaxy-launcher" },
  });
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("download response did not include a body");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const file = fs.createWriteStream(outputPath);
  await new Promise((resolve, reject) => {
    const stream = Readable.fromWeb(response.body);
    stream.on("error", reject);
    stream.pipe(file);
    file.on("finish", resolve);
    file.on("error", reject);
  });
}

function findExtractedBinary(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findExtractedBinary(fullPath);
      if (found) {
        return found;
      }
      continue;
    }
    if (entry.isFile() && (entry.name === "cli-proxy-api" || entry.name === "CLIProxyAPI")) {
      return fullPath;
    }
  }
  return "";
}

async function ensureBinary() {
  if (fs.existsSync(BINARY_PATH) && !envFlag("CLIPROXY_FORCE_DOWNLOAD", false)) {
    return BINARY_PATH;
  }

  const tarCheck = spawnSync("tar", ["--version"], { stdio: "ignore" });
  if (tarCheck.error || tarCheck.status !== 0) {
    throw new Error("the system tar command is required to extract CLIProxyAPI releases");
  }

  const download = await resolveDownload();
  log(`downloading ${download.assetName} from ${download.version}`);

  fs.mkdirSync(BIN_DIR, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cliproxyapi-"));
  const archivePath = path.join(tempDir, download.assetName);
  await downloadFile(download.url, archivePath);

  const extract = spawnSync("tar", ["-xzf", archivePath, "-C", tempDir], { stdio: "inherit" });
  if (extract.error) {
    throw extract.error;
  }
  if (extract.status !== 0) {
    throw new Error(`tar exited with status ${extract.status}`);
  }

  const extractedBinary = findExtractedBinary(tempDir);
  if (!extractedBinary) {
    throw new Error("release archive did not contain cli-proxy-api binary");
  }

  fs.copyFileSync(extractedBinary, BINARY_PATH);
  fs.chmodSync(BINARY_PATH, 0o755);
  return BINARY_PATH;
}

function startBinary(binaryPath, configPath) {
  const env = {
    ...process.env,
    DEPLOY: process.env.DEPLOY || "cloud",
  };

  const child = spawn(binaryPath, ["-config", configPath], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };
  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) {
      log(`CLIProxyAPI stopped by ${signal}`);
      process.exit(0);
    }
    process.exit(code || 0);
  });
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const configPath = ensureConfig();

  if (checkOnly) {
    log("launcher check completed");
    return;
  }

  const binaryPath = await ensureBinary();
  startBinary(binaryPath, configPath);
}

main().catch((error) => {
  console.error(`[galaxy-start] ${error.stack || error.message}`);
  process.exit(1);
});
