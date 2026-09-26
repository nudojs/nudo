#!/usr/bin/env node
/**
 * B3 — VS Code extension smoke (language-client level).
 * Release gate: build artifacts exist + bundled LSP answers initialize
 * with renameProvider. No real VS Code host required.
 */
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vscodePkg = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(vscodePkg, "..", "..");
let failed = 0;

function ok(msg) {
  console.log(`ok   ${msg}`);
}
function fail(msg) {
  console.error(`FAIL ${msg}`);
  failed += 1;
}

async function mustExist(p, label) {
  try {
    await access(p);
    ok(`${label} exists`);
  } catch {
    fail(`${label} missing: ${p}`);
  }
}

function lspInitialize(serverPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = Buffer.alloc(0);
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fn(arg);
    };
    const timer = setTimeout(() => done(reject, new Error("LSP initialize timeout")), 8000);

    child.stdout.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd < 0) break;
        const header = buf.subarray(0, headerEnd).toString("utf8");
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) {
          buf = buf.subarray(headerEnd + 4);
          continue;
        }
        const len = Number(m[1]);
        const bodyStart = headerEnd + 4;
        if (buf.length < bodyStart + len) break;
        const body = buf.subarray(bodyStart, bodyStart + len).toString("utf8");
        buf = buf.subarray(bodyStart + len);
        try {
          const msg = JSON.parse(body);
          if (msg.id === 1) {
            if (msg.error) done(reject, new Error(JSON.stringify(msg.error)));
            else done(resolve, msg.result);
            return;
          }
        } catch {
          /* ignore non-JSON */
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", (e) => done(reject, e));
    child.on("exit", (code) => {
      if (!settled) done(reject, new Error(`LSP exited early (${code})`));
    });

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        processId: process.pid,
        rootUri: null,
        capabilities: {
          textDocument: {
            rename: { prepareSupport: true },
            publishDiagnostics: {},
          },
        },
        workspaceFolders: null,
      },
    });
    child.stdin.write(
      `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`,
    );
  });
}

const extensionJs = join(vscodePkg, "out", "extension.js");
const serverJs = join(vscodePkg, "server", "server.js");
const lspDist = join(root, "packages", "lsp", "dist", "server.js");

await mustExist(extensionJs, "extension.js");
await mustExist(serverJs, "bundled server.js");
await mustExist(lspDist, "lsp dist/server.js");

try {
  const ext = await readFile(extensionJs, "utf8");
  if (/\bactivate\b/.test(ext) && /\bdeactivate\b/.test(ext)) {
    ok("extension.js exports activate/deactivate");
  } else {
    fail("extension.js missing activate/deactivate");
  }
} catch (e) {
  fail(`read extension.js: ${e.message}`);
}

// Prefer the bundled server (what the client launches); fall back to dist.
const target = (await access(serverJs).then(() => true, () => false))
  ? serverJs
  : lspDist;
try {
  const caps = await lspInitialize(target);
  const providers = caps?.capabilities ?? {};
  if (providers.renameProvider) {
    ok("LSP initialize → renameProvider");
  } else {
    fail(`LSP capabilities missing renameProvider: ${JSON.stringify(providers).slice(0, 200)}`);
  }
  if (providers.textDocumentSync != null || providers.hoverProvider != null) {
    ok("LSP initialize → core providers present");
  } else {
    fail("LSP capabilities missing textDocumentSync/hoverProvider");
  }
} catch (e) {
  fail(`LSP initialize handshake: ${e.message}`);
}

if (failed > 0) {
  console.error(`vscode smoke: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("vscode smoke: ok");
