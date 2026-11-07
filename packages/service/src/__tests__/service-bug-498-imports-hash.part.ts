/**
 * Bug 498 回归：Node 的 `#imports`（**导入方** package.json 的 imports 字段）
 * 必须被解析——改前 `#helper` 被当成「包名」⇒ `node_modules/#helper` 必 miss
 * ⇒ 跨模块值塌成 unknown 且零诊断。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveNpmJsEntryDetailed } from "../evaluator/resolve-npm.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

describe("Bug 498 — #imports（包内子路径映射）", () => {
  it("精确键：#helper → 导入方包内的 ./helper.js", () => {
    const dir = tmpProject("nudo-498-exact-", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        type: "module",
        imports: { "#helper": "./helper.js" },
      }),
      "helper.js": "export function h() { return 42; }\n",
    });
    const r = resolveNpmJsEntryDetailed("#helper", dir);
    expect(r.path).toBe(join(dir, "helper.js"));
    expect(r.exportsUnresolved).toBe(false);
  });

  it("模式键：#internal/* → ./src/*.js", () => {
    const dir = tmpProject("nudo-498-pattern-", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        type: "module",
        imports: { "#internal/*": "./src/*.js" },
      }),
      "src/a.js": "export const a = 1;\n",
    });
    const r = resolveNpmJsEntryDetailed("#internal/a", dir);
    expect(r.path).toBe(join(dir, "src", "a.js"));
  });

  it("条件目标按消费形态分表（import / require 各取自己的构建）", () => {
    const dir = tmpProject("nudo-498-cond-", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        type: "module",
        imports: { "#dual": { import: "./esm.mjs", require: "./cjs.cjs" } },
      }),
      "esm.mjs": "export default 1;\n",
      "cjs.cjs": "module.exports = 2;\n",
    });
    expect(resolveNpmJsEntryDetailed("#dual", dir, "import").path).toBe(join(dir, "esm.mjs"));
    expect(resolveNpmJsEntryDetailed("#dual", dir, "require").path).toBe(join(dir, "cjs.cjs"));
  });

  it("外部包目标：#dep → 裸包（转入裸包入口解析）", () => {
    const dir = tmpProject("nudo-498-external-", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        type: "module",
        imports: { "#dep": "dep" },
      }),
      "node_modules/dep/package.json": JSON.stringify({
        name: "dep",
        version: "1.0.0",
        exports: { ".": "./index.js" },
      }),
      "node_modules/dep/index.js": "export const x = 1;\n",
    });
    expect(resolveNpmJsEntryDetailed("#dep", dir).path).toBe(
      join(dir, "node_modules", "dep", "index.js"),
    );
  });

  it("解析不到 ⇒ exportsUnresolved=true（真缺失，不得静默塌成 unknown）", () => {
    const dir = tmpProject("nudo-498-miss-", {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        type: "module",
        imports: { "#helper": "./helper.js" },
      }),
      "helper.js": "export const x = 1;\n",
    });
    const r = resolveNpmJsEntryDetailed("#nope", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });

  it("负控制：普通裸包不受 # 分支影响（仍走 exports 解析）", () => {
    const dir = tmpProject("nudo-498-bare-", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", type: "module" }),
      "node_modules/plain/package.json": JSON.stringify({
        name: "plain",
        version: "1.0.0",
        exports: { ".": "./index.js" },
      }),
      "node_modules/plain/index.js": "export const x = 1;\n",
    });
    expect(resolveNpmJsEntryDetailed("plain", dir).path).toBe(
      join(dir, "node_modules", "plain", "index.js"),
    );
  });
});
