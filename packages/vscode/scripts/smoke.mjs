#!/usr/bin/env node
/**
 * B3 — VS Code extension smoke (language-client level).
 * Release gate: build artifacts exist + bundled LSP answers initialize
 * with renameProvider. No real VS Code host required.
 *
 * ── Bug 907 / 999：隔离布局（VSIX 的**实际**布局）门禁 ─────────────
 * VSIX 里**没有 node_modules**（`.vscodeignore` 排 `node_modules/` +
 * `vsce package --no-dependencies`）⇒ 产物必须**自包含**；
 * Node 判定模块类型**只看最近的 `package.json` 的 `type`** ⇒ 产物旁必须
 * 有 `{"type":"module"}`，否则 Node < 22.18 上
 * `SyntaxError: Cannot use import statement outside a module`。
 *
 * ⚠ **旧门禁恒绿**：它在 monorepo 布局里跑同一份产物 ⇒ 能从仓库根
 * `node_modules` 解析到 `@babel/*` ⇒ **永远发现不了**「产物依赖 monorepo
 * 的 node_modules」这一类缺陷（假绿放行）。
 * ⇒ 新门禁把产物复制到**没有 node_modules 的临时目录**再启动。
 *
 * ── Bug 906：清单与依赖的版本契约 ─────────────────────────────────
 * `vscode-languageclient` 在 `LanguageClient` **构造函数体**里硬校验
 * `REQUIRED_VSCODE_VERSION` ⇒ 清单承诺的 `engines.vscode` 必须**满足**它，
 * 否则扩展在自己声明允许的宿主版本上**根本不激活**。
 */
import { spawn, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vscodePkg = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(vscodePkg, "..", "..");
let failed = 0;

/** node 内置模块名（`node:` 前缀变体在内）——它们不算「外部依赖」。 */
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/** 模块层面的失败特征（907 依赖缺失 / 999 模块类型）。 */
const MODULE_FAILURE =
  /Cannot find package|ERR_MODULE_NOT_FOUND|Cannot use import statement outside a module|MODULE_TYPELESS_PACKAGE_JSON|ERR_REQUIRE_ESM/;

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

// ── Bug 906：清单承诺的宿主版本必须满足依赖的构造期硬校验 ──────────
{
  const require = createRequire(import.meta.url);
  const manifest = JSON.parse(
    await readFile(join(vscodePkg, "package.json"), "utf8"),
  );
  const declared = manifest.engines?.vscode;
  let required;
  try {
    // `vscode-languageclient` 的 `exports` 不暴露 `lib/node/main.js` ⇒
    // 先解析包入口（`lib/common/api.js`），再走到 `lib/node/main.js`。
    const lcEntry = require.resolve("vscode-languageclient");
    const lcMain = join(dirname(lcEntry), "..", "node", "main.js");
    const src = await readFile(lcMain, "utf8");
    required = /const REQUIRED_VSCODE_VERSION = '([^']+)'/.exec(src)?.[1];
  } catch (e) {
    fail(`read vscode-languageclient REQUIRED_VSCODE_VERSION: ${e.message}`);
  }
  if (required) {
    // 依赖只硬校验**下界** ⇒ 清单承诺的**下界**必须 ≥ 依赖要求的下界。
    const floor = /^\^?(\d+)\.(\d+)\.(\d+)/.exec(declared ?? "");
    const need = /^\^?(\d+)\.(\d+)\.(\d+)/.exec(required);
    const satisfies =
      !!floor &&
      !!need &&
      (Number(floor[1]) > Number(need[1]) ||
        (Number(floor[1]) === Number(need[1]) &&
          (Number(floor[2]) > Number(need[2]) ||
            (Number(floor[2]) === Number(need[2]) &&
              Number(floor[3]) >= Number(need[3])))));
    if (satisfies) {
      ok(`engines.vscode ${declared} satisfies vscode-languageclient ${required}`);
    } else {
      fail(
        `engines.vscode ${declared} does NOT satisfy vscode-languageclient ${required}`,
      );
    }
  }
}

// ── Bug 999：根清单必须保持 CommonJS（扩展包 out/extension.js 是 CJS） ──
{
  const manifest = JSON.parse(
    await readFile(join(vscodePkg, "package.json"), "utf8"),
  );
  if (manifest.type === "module") {
    fail('root manifest sets "type":"module" — out/extension.js is a CJS bundle');
  } else {
    ok("root manifest stays CommonJS (out/extension.js is a CJS bundle)");
  }
}

// ── Bug 907 / 999：隔离布局（VSIX 的实际布局）门禁 ─────────────────
// 产物在**没有 node_modules** 的目录里必须能起来（自包含 + ESM 身份）。
{
  const bundleDir = await mkdtemp(join(tmpdir(), "nudo-vscode-bundle-"));
  const build = spawnSync(
    process.execPath,
    [join(vscodePkg, "scripts", "bundle-server.mjs"), "--out-dir", bundleDir],
    { encoding: "utf8", timeout: 300000 },
  );
  if (build.status !== 0) {
    fail(
      `bundle-server.mjs failed: ${(build.stderr ?? build.stdout ?? "").trim().slice(0, 600)}`,
    );
  } else {
    ok("bundle-server.mjs produced a self-contained server artifact");
    const artifact = join(bundleDir, "server.js");
    const manifestFile = join(bundleDir, "package.json");

    // 999：产物旁必须有 {"type":"module"}（Node 只看最近的 package.json）
    try {
      const m = JSON.parse(await readFile(manifestFile, "utf8"));
      if (m.type === "module") {
        ok("bundled server has an ESM manifest next to it");
      } else {
        fail(`bundled server manifest type = ${JSON.stringify(m.type)} (want "module")`);
      }
    } catch (e) {
      fail(`bundled server manifest: ${e.message}`);
    }

    // 907：产物里不得再有裸包 import
    try {
      const src = await readFile(artifact, "utf8");
      const externals = [
        ...new Set(
          [...src.matchAll(/^import\s[^;]*?from\s*"([^"]+)";/gm)]
            .map((m) => m[1])
            .filter(
              (s) => !s.startsWith(".") && !s.startsWith("/") && !builtins.has(s),
            ),
        ),
      ];
      if (externals.length === 0) {
        ok("bundled server has 0 external package imports");
      } else {
        fail(`bundled server still imports: ${externals.join(", ")}`);
      }
    } catch (e) {
      fail(`read bundled server: ${e.message}`);
    }

    // 907 + 999：隔离目录（无 node_modules）里启动
    const iso = await mkdtemp(join(tmpdir(), "nudo-vscode-iso-"));
    try {
      await mkdir(join(iso, "server"), { recursive: true });
      await cp(artifact, join(iso, "server/server.js"));
      await cp(manifestFile, join(iso, "server/package.json"));
      const args = process.allowedNodeEnvironmentFlags.has(
        "--no-experimental-detect-module",
      )
        ? ["--no-experimental-detect-module", "server/server.js"]
        : ["server/server.js"];
      const run = spawnSync(process.execPath, args, {
        cwd: iso,
        encoding: "utf8",
        timeout: 20000,
        input: "",
      });
      const stderr = run.stderr ?? "";
      const failure = MODULE_FAILURE.exec(stderr);
      if (failure) {
        fail(
          `bundled server does not start in a VSIX-like layout: ${stderr.trim().slice(0, 400)}`,
        );
      } else {
        ok("bundled server starts in a VSIX-like layout (no node_modules)");
      }
    } finally {
      await rm(iso, { recursive: true, force: true });
    }
    await rm(bundleDir, { recursive: true, force: true });
  }
}

if (failed > 0) {
  console.error(`vscode smoke: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("vscode smoke: ok");
