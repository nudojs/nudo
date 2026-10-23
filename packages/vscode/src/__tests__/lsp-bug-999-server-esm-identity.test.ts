/**
 * Bug 999 —— 发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json`
 * 没有 `"type": "module"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上
 * 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module`
 * ⇒ 整个 IDE 侧产品零功能；而 CI **从不测 VSIX** ⇒ **恒绿**。
 *
 * 根因：Node 判定模块类型**只看最近的 `package.json` 的 `type` 字段**（或
 * `.mjs` 后缀），**不看文件内容** ⇒ `packages/lsp/package.json` 的
 * `"type": "module"` 不会跟着 `cp` 走。
 *
 * 修法（**只改 `packages/vscode/scripts/bundle-server.mjs`**）：在 `server/`
 * 目录里**额外写一个 `package.json`（`{"type":"module"}`）** ⇒ Node 只看
 * **最近的** `package.json` ⇒ 产物拿到 ESM 身份。
 *
 * ⚠ **不能**在 `packages/vscode/package.json` **根**上加 `"type": "module"`：
 * 根清单加它会让 `out/extension.js`（tsup 打的 **CJS** 包，
 * `main: "./out/extension.js"`）变成 ESM 解释 ⇒ **扩展直接加载失败**。
 * ⇒ 本钉把「根清单保持 CommonJS」也钉住，避免回归成根改法。
 *
 * 原生 oracle：`node --no-experimental-detect-module`（Node < 22.18 的判定
 * 语义）下，产物仍必须能启动 ⇒ 它必须有**显式**的 ESM 身份。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runBundler,
  runIsolated,
  vscodeDir,
} from "./vscode-bundle-harness.ts";

/** Node ≥ 22.18 支持 `--no-experimental-detect-module`（关闭模块语法检测）。 */
const noDetect = process.allowedNodeEnvironmentFlags.has(
  "--no-experimental-detect-module",
)
  ? ["--no-experimental-detect-module"]
  : [];

describe("Bug 999 —— VSIX 里的 LSP server 必须保住 ESM 身份", () => {
  const run = runBundler();

  it("打包脚本成功产出 server artifact", () => {
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(run.artifact)).toBe(true);
  });

  it("产物旁有 {\"type\":\"module\"} 的清单（Node 只看最近的 package.json）", () => {
    expect(existsSync(run.manifest)).toBe(true);
    const manifest = JSON.parse(readFileSync(run.manifest, "utf8"));
    expect(manifest.type).toBe("module");
  });

  it("根清单**没有**把整个包翻成 ESM（CJS 扩展包 out/extension.js 不受影响）", () => {
    const manifest = JSON.parse(
      readFileSync(join(vscodeDir, "package.json"), "utf8"),
    );
    expect(manifest.type).toBeUndefined();
    expect(manifest.main).toBe("./out/extension.js");
  });

  it("node --no-experimental-detect-module 下产物仍能启动（ESM 身份是显式的）", () => {
    const isolated = runIsolated(run.artifact, run.manifest, noDetect);
    expect(isolated.stderr).not.toMatch(
      /Cannot use import statement outside a module|MODULE_TYPELESS_PACKAGE_JSON/,
    );
    expect(isolated.stdout).toContain("NUDO_FAKE_LSP_SERVER");
    expect(isolated.status).toBe(0);
  });

  it("没有 ESM 清单时，同一份产物在同样的 Node 语义下**起不来**（钉住因果）", () => {
    // 把清单拿走 ⇒ Node 只剩「模块语法检测」这条兜底 ⇒
    // 在关闭检测的语义下必须失败（否则本钉的第一条断言就没有约束力）。
    const isolated = runIsolated(run.artifact, null, noDetect);
    expect(isolated.stdout).not.toContain("NUDO_FAKE_LSP_SERVER");
  });

  it("打包脚本负责写 ESM 清单（不是靠根清单）", () => {
    const src = readFileSync(join(vscodeDir, "scripts/bundle-server.mjs"), "utf8");
    expect(src).toMatch(/type:\s*"module"/);
  });
});
