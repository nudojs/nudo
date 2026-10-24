#!/usr/bin/env node
/**
 * Bundle the LSP server into a **self-contained ESM artifact** for the VSIX.
 *
 * ── Bug 907（发布产物确定缺依赖） ──────────────────────────────
 * `packages/lsp/tsup.config.ts` 的 `noExternal` 只覆盖 `@nudojs/*` 与
 * `vscode-languageserver*` ⇒ `@babel/*` 被 externalize ⇒
 * `packages/lsp/dist/server.js` 尾部有 **6 条裸 `@babel/*` import**。
 * 叠加 `packages/vscode/.vscodeignore` 的 `node_modules/` 与
 * `vsce package --no-dependencies` ⇒ **VSIX 里没有 node_modules**
 * ⇒ 语言服务器启动即崩 `ERR_MODULE_NOT_FOUND: Cannot find package '@babel/types'`。
 * 而 smoke 门禁在 monorepo 布局里跑（能从仓库根 `node_modules` 解析到
 * `@babel/*`）⇒ **恒绿放行**。
 *
 * 修法（**只改本文件，`packages/lsp` 零改动**）：对 `packages/lsp/dist/server.js`
 * **再打一次 esbuild bundle**（`bundle: true`；除 node 内置外全部内联）
 * ⇒ 产物是**自包含单文件**。
 *
 * ── Bug 999（产物丢了 ESM 身份） ──────────────────────────────
 * Node 判定模块类型**只看最近的 `package.json` 的 `type`**（或 `.mjs` 后缀），
 * **不看文件内容** ⇒ `packages/lsp/package.json` 的 `"type": "module"`
 * 不会跟着拷贝走 ⇒ `packages/vscode/server/server.js` 在
 * `packages/vscode/package.json`（**无 `type` ⇒ CommonJS**）下被当作 CJS
 * ⇒ Node < 22.18（无模块语法检测）上
 * `SyntaxError: Cannot use import statement outside a module`。
 *
 * 修法：在 `server/` 目录里**额外写一个 `package.json`（`{"type":"module"}`）**
 * ⇒ Node 只看**最近的** `package.json` ⇒ 产物拿到 ESM 身份；
 * **根清单零改动** ⇒ `out/extension.js`（tsup 打的 **CJS** 包，
 * `main: "./out/extension.js"`）不受影响。
 *
 * ── 自检 ─────────────────────────────────────────────────────
 * 打包后把产物复制到**没有 node_modules 的临时目录**（= VSIX 的实际布局）
 * 启动一次 ⇒ 模块解析 / 模块类型出错就**让构建失败**，而不是等用户装上
 * 才发现。
 *
 * ⚠ esbuild **不是**本包的依赖：工作区通过 `tsup`（构建脚本本来就在用）
 * 提供它 ⇒ 这里沿用工作区已解析的副本，**不改 `package.json` 的依赖**
 * （那会连带改共享的 `pnpm-lock.yaml`）。
 */
import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const vscodePkg = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(vscodePkg, "..", "lsp", "dist", "server.js");

/** `--out-dir <dir>`：把产物写到别处（smoke 门禁用它做隔离布局验证）。 */
function parseOutDir(argv) {
  const i = argv.indexOf("--out-dir");
  if (i < 0) return join(vscodePkg, "server");
  const value = argv[i + 1];
  if (!value) {
    console.error("--out-dir needs a directory argument");
    process.exit(1);
  }
  return value;
}

const destDir = parseOutDir(process.argv.slice(2));
const dest = join(destDir, "server.js");
/** Bug 999：产物旁的清单 —— Node 只看**最近**的 package.json。 */
const destManifest = join(destDir, "package.json");

/** node 内置模块名（`node:` 前缀的变体也在内）——它们不算「外部依赖」。 */
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/**
 * 载入工作区已解析的 esbuild。
 *
 * 优先直接 `require("esbuild")`；工作区里 esbuild 是 **tsup 的依赖**
 * （`tsup` 本身就是 esbuild 的封装）⇒ 退回「从 tsup 的依赖树里解析」。
 * ⚠ 两条路都走不通时**明确报错**（而不是悄悄产出一份不自包含的产物）。
 */
function loadEsbuild() {
  try {
    return require("esbuild");
  } catch {
    /* 继续走 tsup 依赖树 */
  }
  try {
    const tsupEntry = require.resolve("tsup");
    return require(require.resolve("esbuild", { paths: [dirname(tsupEntry)] }));
  } catch {
    /* 两条路都不通 */
  }
  throw new Error(
    "esbuild is not resolvable — the workspace ships it through tsup " +
      "(the build script already uses tsup). Run `pnpm install` before bundling.",
  );
}

/** 产物里的**裸包 import**（`import … from "<pkg>"`）——自包含产物必须为 0。 */
function externalPackageImports(source) {
  const specs = [
    ...source.matchAll(/^import\s[^;]*?from\s*"([^"]+)";/gm),
  ].map((m) => m[1]);
  return [
    ...new Set(
      specs.filter(
        (s) => !s.startsWith(".") && !s.startsWith("/") && !builtins.has(s),
      ),
    ),
  ];
}

/** 启动一个 node 进程，最多等 `timeoutMs`；返回退出码与 stderr。 */
function runNode(args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve({ code, stderr });
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.stdout.on("data", () => {});
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", (e) => {
      stderr += String(e);
      finish(null);
    });
    child.on("exit", (code) => finish(code));
    child.stdin.end();
  });
}

/** 模块层面的失败特征（907 依赖缺失 / 999 模块类型）。 */
const MODULE_FAILURE =
  /Cannot find package|ERR_MODULE_NOT_FOUND|Cannot use import statement outside a module|MODULE_TYPELESS_PACKAGE_JSON|ERR_REQUIRE_ESM/;

/**
 * 自检：把产物放进**没有 node_modules 的临时目录**（= VSIX 的实际布局）
 * 启动一次 ⇒ 模块解析 / 模块类型出错 ⇒ 构建失败。
 */
async function assertSelfContained() {
  const dir = await mkdtemp(join(tmpdir(), "nudo-vsix-check-"));
  try {
    await mkdir(join(dir, "server"), { recursive: true });
    await cp(dest, join(dir, "server/server.js"));
    await cp(destManifest, join(dir, "server/package.json"));
    const { stderr } = await runNode([join(dir, "server/server.js")], dir, 8000);
    const failure = MODULE_FAILURE.exec(stderr);
    if (failure) {
      throw new Error(
        `bundled server is not self-contained in a VSIX-like layout:\n${stderr.trim()}`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

try {
  await access(src);
} catch {
  console.error(
    "Missing packages/lsp/dist/server.js — build the monorepo first (pnpm build, or pnpm --filter @nudojs/lsp run build).",
  );
  process.exit(1);
}

const esbuild = loadEsbuild();

await mkdir(destDir, { recursive: true });

// Bug 907：二次打包 ⇒ 除 node 内置外全部内联 ⇒ 自包含单文件。
await esbuild.build({
  entryPoints: [src],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: dest,
  logLevel: "warning",
});

// Bug 999：产物旁的清单给 ESM 身份（根清单保持 CJS，扩展包不受影响）。
await writeFile(destManifest, `${JSON.stringify({ type: "module" }, null, 2)}\n`);

const externals = externalPackageImports(await readFile(dest, "utf8"));
if (externals.length > 0) {
  console.error(
    `Bundled server still imports external packages: ${externals.join(", ")}`,
  );
  process.exit(1);
}

await assertSelfContained();

console.log(`Bundled LSP server → ${dest}`);
console.log(`LSP server module type → ${destManifest} ({"type":"module"})`);
