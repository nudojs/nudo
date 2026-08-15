/// @nudo:env node

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { platform, homedir } from "node:os";

/**
 * @nudo:case "read" (T.string)
 */
function loadJsonConfig(filePath) {
  const content = readFileSync(filePath, "utf-8");
  // @nudo:as T.object({ port: T.number, host: T.string, debug: T.boolean })
  const config = JSON.parse(content);
  return config;
}

/**
 * @nudo:case "check" (T.string)
 */
function fileInfo(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  const stat = statSync(filePath);
  return {
    isDir: stat.isDirectory(),
    size: stat.size,
    ext: extname(filePath),
    dir: dirname(filePath),
  };
}

/**
 * @nudo:case "build" ("src", "utils", "index.js")
 * @nudo:case "symbolic" (T.string, T.string, T.string)
 */
function buildPath(base, sub, file) {
  return join(base, sub, file);
}

/**
 * @nudo:case "hash" ("hello world")
 */
function hashContent(data) {
  const hash = createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}

/**
 * @nudo:case "info" ()
 */
function systemInfo() {
  return {
    os: platform(),
    home: homedir(),
    pid: process.pid,
    cwd: process.cwd(),
    id: randomUUID(),
  };
}
