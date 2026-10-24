/**
 * Shared harness for the **packaging-side** pins (Bug 907 / Bug 999).
 *
 * The two bugs live in the **VSIX layout**, not in the monorepo:
 *   - 907: the VSIX ships **no node_modules** (`.vscodeignore` drops
 *     `node_modules/`, `vsce package --no-dependencies`) ⇒ the bundled LSP
 *     server must be **self-contained** (no bare package imports).
 *   - 999: Node decides a file's module type from the **nearest**
 *     `package.json`'s `type` field ⇒ the bundled server needs an ESM
 *     manifest **next to it** (the root manifest stays CommonJS so the CJS
 *     extension bundle keeps loading).
 *
 * The harness runs the **real** `packages/vscode/scripts/bundle-server.mjs`
 * against a **fake monorepo layout** (a throw-away directory that mimics
 * `<repo>/packages/{vscode,lsp}`):
 *
 *   <tmp>/packages/vscode/scripts/bundle-server.mjs   ← copy of the real one
 *   <tmp>/packages/lsp/dist/server.js                 ← the fixture
 *   <tmp>/node_modules → <repo>/node_modules          ← symlink (esbuild/tsup)
 *
 * ⇒ the pins need **no build output** and are **hermetic**: on the pre-fix
 * tree the bundler merely *copies* the fixture, so the artifact keeps its
 * bare import (907) and has no ESM manifest (999) ⇒ both pins fail there.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `packages/vscode/` */
export const vscodeDir = fileURLToPath(new URL("../../", import.meta.url));
/** 仓库根 */
export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/**
 * 假的 `packages/lsp/dist/server.js`：**ESM 语法**（`export` ⇒ 产物里必有
 * ESM 语法 ⇒ `--no-experimental-detect-module` 下会暴露模块类型问题）
 * ＋ 一条**裸包 import**（`ms` 是工作区的根 devDependency ⇒ 真实可解析）
 * ⇒ 一次覆盖 907（自包含）与 999（ESM 身份）两个断言面。
 */
export const FAKE_LSP_SERVER = `import ms from "ms";
export const nudoFixtureMarker = "nudo-esm-fixture";
process.stdout.write(\`NUDO_FAKE_LSP_SERVER \${typeof ms}\\n\`);
`;

export type BundleRun = {
  /** 假仓库根（`packages/{vscode,lsp}` 在里面） */
  root: string;
  /** 产物路径 */
  artifact: string;
  /** 产物旁的清单路径 */
  manifest: string;
  /** 打包脚本的退出码 */
  status: number | null;
  /** 打包脚本的 stdout */
  stdout: string;
  /** 打包脚本的 stderr */
  stderr: string;
};

/** 运行**真实**的 `bundle-server.mjs`（假仓库布局 ⇒ 不依赖任何构建产物）。 */
export function runBundler(fixture: string = FAKE_LSP_SERVER): BundleRun {
  const root = mkdtempSync(join(tmpdir(), "nudo-vscode-bundle-"));
  const vscodeScripts = join(root, "packages/vscode/scripts");
  const lspDist = join(root, "packages/lsp/dist");
  mkdirSync(vscodeScripts, { recursive: true });
  mkdirSync(lspDist, { recursive: true });
  cpSync(
    join(vscodeDir, "scripts/bundle-server.mjs"),
    join(vscodeScripts, "bundle-server.mjs"),
  );
  mkdirSync(join(lspDist), { recursive: true });
  writeFileSync(join(lspDist, "server.js"), fixture);
  // esbuild / tsup 的解析入口（工作区已解析的副本）——**只读**引用。
  symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"));

  const run = spawnSync(
    process.execPath,
    [join(vscodeScripts, "bundle-server.mjs")],
    { cwd: root, encoding: "utf8", timeout: 300000 },
  );
  return {
    root,
    artifact: join(root, "packages/vscode/server/server.js"),
    manifest: join(root, "packages/vscode/server/package.json"),
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
  };
}

/** 产物里的**裸包 import**（自包含产物必须为 0）。 */
export function externalPackageImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const builtins = new Set([
    "module",
    "url",
    "fs",
    "path",
    "os",
    "async_hooks",
    "crypto",
    "child_process",
    "util",
    "events",
    "stream",
    "buffer",
    "tty",
    "assert",
    "http",
    "https",
    "net",
    "worker_threads",
    "readline",
    "perf_hooks",
    "timers",
    "vm",
    "v8",
    "process",
    "console",
    "constants",
    "dns",
    "cluster",
    "domain",
    "string_decoder",
    "querystring",
    "zlib",
  ]);
  const specs = [
    ...src.matchAll(/^import\s[^;]*?from\s*"([^"]+)";/gm),
  ].map((m) => m[1]!);
  return [
    ...new Set(
      specs.filter(
        (s) => !s.startsWith(".") && !s.startsWith("/") && !builtins.has(s),
      ),
    ),
  ];
}

/**
 * 把产物复制到**没有 node_modules 的目录**（= VSIX 的实际布局）再启动。
 *
 * @param extraArgs 传给 node 的额外参数（`--no-experimental-detect-module`
 *   ⇒ Node < 22.18 的模块类型判定语义）
 */
export function runIsolated(
  artifact: string,
  manifest: string | null,
  extraArgs: string[] = [],
): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vscode-iso-"));
  mkdirSync(join(dir, "server"), { recursive: true });
  cpSync(artifact, join(dir, "server/server.js"));
  if (manifest) cpSync(manifest, join(dir, "server/package.json"));
  const run = spawnSync(
    process.execPath,
    [...extraArgs, "server/server.js"],
    { cwd: dir, encoding: "utf8", timeout: 30000, input: "" },
  );
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
  };
}
