#!/usr/bin/env node
/**
 * B4 — Zed/Nvim protocol smoke (stdio): hover + push diagnostics.
 * Editors that launch `nudo-lsp` over stdio (Zed, Neovim, Helix) need this
 * face; VS Code bundles its own transport. No editor host required.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const lspPkg = dirname(dirname(fileURLToPath(import.meta.url)));
const serverJs = existsSync(join(lspPkg, "dist", "server.js"))
  ? join(lspPkg, "dist", "server.js")
  : null;

if (!serverJs) {
  console.error("FAIL missing packages/lsp/dist/server.js — run pnpm --filter @nudojs/lsp run build");
  process.exit(1);
}

let failed = 0;
const ok = (m) => console.log(`ok   ${m}`);
const fail = (m) => {
  console.error(`FAIL ${m}`);
  failed += 1;
};

function send(child, msg) {
  const payload = JSON.stringify(msg);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
}

function runSmoke() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverJs], { stdio: ["pipe", "pipe", "pipe"] });
    let buf = Buffer.alloc(0);
    let gotDiags = false;
    let gotHover = false;
    let initCaps = null;
    const pending = new Map();
    let nextId = 1;

    const request = (method, params) =>
      new Promise((res) => {
        const id = nextId++;
        pending.set(id, res);
        send(child, { jsonrpc: "2.0", id, method, params });
      });

    const timer = setTimeout(() => {
      child.kill();
      if (gotDiags && gotHover) resolve({ initCaps, gotDiags, gotHover });
      else reject(new Error(`timeout (diags=${gotDiags} hover=${gotHover})`));
    }, 12000);

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
        let msg;
        try {
          msg = JSON.parse(body);
        } catch {
          continue;
        }
        if (msg.id !== undefined && pending.has(msg.id)) {
          const res = pending.get(msg.id);
          pending.delete(msg.id);
          res(msg.result ?? msg.error);
          continue;
        }
        if (msg.method === "textDocument/publishDiagnostics") {
          const diags = msg.params?.diagnostics ?? [];
          if (diags.length > 0) {
            gotDiags = true;
            ok(`publishDiagnostics (${diags.length} item(s), e.g. ${diags[0].code ?? "?"})`);
          }
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      if (gotDiags && gotHover) resolve({ initCaps, gotDiags, gotHover });
      else if (!gotDiags || !gotHover) {
        reject(new Error(`server exited (diags=${gotDiags} hover=${gotHover})`));
      }
    });

    (async () => {
      const init = await request("initialize", {
        processId: process.pid,
        rootUri: null,
        capabilities: {
          textDocument: {
            hover: { contentFormat: ["markdown", "plaintext"] },
            publishDiagnostics: {},
            synchronization: { didSave: true },
          },
        },
        workspaceFolders: null,
      });
      initCaps = init?.capabilities ?? {};
      if (initCaps.hoverProvider) ok("initialize → hoverProvider");
      else fail("initialize missing hoverProvider");
      // push diagnostics need not declare a provider; pull does
      if (initCaps.textDocumentSync != null) ok("initialize → textDocumentSync");
      else fail("initialize missing textDocumentSync");

      send(child, { jsonrpc: "2.0", method: "initialized", params: {} });

      const uri = "file:///nudo-b4-smoke.js";
      const text = [
        "export function getName(user) {",
        "  return user.name;",
        "}",
        "getName({});",
        "",
      ].join("\n");
      send(child, {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: { uri, languageId: "javascript", version: 1, text },
        },
      });

      // hover on `getName` at line 1 (export function getName)
      // LSP is 0-based: line 0, character 16
      const hover = await request("textDocument/hover", {
        textDocument: { uri },
        position: { line: 0, character: 17 },
      });
      if (hover && (hover.contents !== undefined)) {
        gotHover = true;
        ok("textDocument/hover → contents");
      } else {
        fail(`textDocument/hover empty: ${JSON.stringify(hover)?.slice(0, 120)}`);
      }

      // diagnostics arrive async via publishDiagnostics
      await new Promise((r) => setTimeout(r, 2500));
      if (!gotDiags) fail("no textDocument/publishDiagnostics with issues");
      send(child, { jsonrpc: "2.0", id: nextId++, method: "shutdown" });
      send(child, { jsonrpc: "2.0", method: "exit" });
      clearTimeout(timer);
      resolve({ initCaps, gotDiags, gotHover });
    })().catch((e) => {
      clearTimeout(timer);
      child.kill();
      reject(e);
    });
  });
}

try {
  await runSmoke();
} catch (e) {
  fail(e.message);
}

if (failed > 0) {
  console.error(`lsp stdio smoke: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("lsp stdio smoke: ok (hover + push diagnostics)");
