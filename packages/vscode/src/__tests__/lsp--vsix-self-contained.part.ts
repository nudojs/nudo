/**
 * Bug 907 —— 发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器
 * **启动即崩** `ERR_MODULE_NOT_FOUND`；而 CI 的 smoke 门禁在 monorepo 布局里
 * 跑 ⇒ **假绿放行**。
 *
 * 三层叠加（缺一不可）：
 *   1. `packages/lsp/tsup.config.ts` 的 `noExternal` 不含 `@babel/*`
 *      ⇒ `packages/lsp/dist/server.js` 尾部有 **6 条裸 `@babel/*` import**；
 *   2. `packages/vscode/scripts/bundle-server.mjs` 原来**只 `cp` 不重打包**
 *      ⇒ 外部 import 原样进 VSIX；
 *   3. `packages/vscode/.vscodeignore` 排 `node_modules/` +
 *      `vsce package --no-dependencies` ⇒ 外部依赖**确定不在包里**。
 *
 * 修法（**只改 `packages/vscode/scripts/bundle-server.mjs`**，`packages/lsp`
 * 零改动）：对 `packages/lsp/dist/server.js` **再打一次 esbuild bundle**
 * （`bundle: true`；除 node 内置外全部内联）⇒ 产物是**自包含单文件**。
 *
 * 原生 oracle：**VSIX 的实际布局 = 没有 node_modules 的目录** ⇒ 产物在那里
 * 必须能起来。本钉用**假仓库布局**跑**真实**的打包脚本（不依赖任何构建
 * 产物），断言：
 *   1. 产物里**裸包 import = 0**（自包含）；
 *   2. 产物在**没有 node_modules 的目录**里能启动。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  externalPackageImports,
  runBundler,
  runIsolated,
  vscodeDir,
} from "./vscode-bundle-harness.ts";

describe("Bug 907 —— VSIX 里的 LSP server 必须自包含", () => {
  const run = runBundler();

  it("打包脚本成功产出 server artifact", () => {
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(run.artifact)).toBe(true);
  });

  it("产物里没有任何裸包 import（自包含 ⇒ 0 条外部依赖）", () => {
    expect(externalPackageImports(run.artifact)).toEqual([]);
  });

  it("产物在**没有 node_modules 的目录**（VSIX 布局）里能启动", () => {
    const isolated = runIsolated(run.artifact, run.manifest);
    expect(isolated.stderr).not.toMatch(/Cannot find package|ERR_MODULE_NOT_FOUND/);
    expect(isolated.stdout).toContain("NUDO_FAKE_LSP_SERVER");
    expect(isolated.status).toBe(0);
  });

  it("打包脚本是**再打一次 bundle**（不再只是 cp）", () => {
    const src = readFileSync(join(vscodeDir, "scripts/bundle-server.mjs"), "utf8");
    expect(src).toMatch(/bundle:\s*true/);
    expect(src).toMatch(/esbuild/);
  });

  it("自检面：打包脚本自己在隔离布局里验过产物（构建期即失败）", () => {
    const src = readFileSync(join(vscodeDir, "scripts/bundle-server.mjs"), "utf8");
    expect(src).toMatch(/assertSelfContained/);
    expect(src).toMatch(/mkdtemp/);
  });
});
