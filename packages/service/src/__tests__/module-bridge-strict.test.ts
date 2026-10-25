/**
 * Abs 模块导出桥的源种类严格性（`evalExportsToModuleExports`）：
 * 模块 AST 含 ESM 语法（静态 import/export 或 `import.meta`）⇒ 桥接 fn 的
 * `AbsFnImpl.strict = true`，与模块体 B run 的 `"use strict"` 前缀同口径；
 * 无 ESM 语法的 CJS/sloppy 源 ⇒ `strict = false`（显式 sloppy，不是缺省）。
 *
 * 同一判据也覆盖 `collectAbsBindingsFromGraph` 的根侧私有顶层函数绑定
 * （宿主函数 → 同一导出桥转换）。
 *
 * 注：transpile 运行期已建好的 Abs fn（`export const f = () => …` 等）在桥里
 * **按身份透传**（`isAbsVal` 分支）——它们不由本桥构造，strict 由 core 运行期
 * 负责；本桥不重建共享 Abs（会丢 WeakMap 侧 impl/预算键身份）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import { evalAbsModuleGraph, collectAbsBindingsFromGraph } from "@nudojs/service";
import { getFnImpl } from "@nudojs/core";
import { evalExportsToModuleExports } from "../abs-modules-graph.ts";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

function tmpProject(files: Record<string, string>): string {
  return makeTmpProject("nudo-abs-mod-strict-", files);
}

/** 宿主 JS 函数（转译模块导出的函数声明形态） */
function hostAdd(a: unknown, b: unknown): unknown {
  return [a, b];
}

describe("module export bridge: source-kind strictness", () => {
  it("ESM dependency export carries strict=true", () => {
    const dir = tmpProject({
      "math.js": `export function double(x) { return x * 2; }`,
    });
    const mainSrc = `import { double } from "./math.js";
export function run(n) { return double(n); }
`;
    const { modules } = evalAbsModuleGraph(mainSrc, join(dir, "main.js"));
    const doubleAbs = modules["./math.js"]!.named.double!;
    expect(doubleAbs).toBeDefined();
    expect(getFnImpl(doubleAbs)?.strict).toBe(true);
  });

  it("host-function bridge: ESM source → strict=true", () => {
    const source = `export function add(a, b) { return a + b; }`;
    const exportsAbs = evalExportsToModuleExports(
      { add: hostAdd },
      parse(source),
      "unit:esm",
    );
    expect(getFnImpl(exportsAbs.named.add!)?.strict).toBe(true);
  });

  it("host-function bridge: CJS source (no ESM syntax) → strict=false", () => {
    const source = `function add(a, b) { return a + b; }`;
    const exportsAbs = evalExportsToModuleExports(
      { add: hostAdd },
      parse(source),
      "unit:cjs",
    );
    expect(getFnImpl(exportsAbs.named.add!)?.strict).toBe(false);
  });

  it("root private fn bindings follow the root source kind", () => {
    const esm = `const x = 1;
function helper() { return x; }
export { x };
`;
    const esmBinds = collectAbsBindingsFromGraph(esm, "/tmp/nudo-strict-esm-bindings.js");
    expect(getFnImpl(esmBinds.get("helper")!)?.strict).toBe(true);

    const cjs = `const x = 1;
function helper() { return x; }
module.exports = { x };
`;
    const cjsBinds = collectAbsBindingsFromGraph(cjs, "/tmp/nudo-strict-cjs-bindings.js");
    expect(getFnImpl(cjsBinds.get("helper")!)?.strict).toBe(false);
  });
});
