/**
 * Bug 463 / 483 / 484：跨模块导出的 fn 形参面——
 *  - 463：`export function` 的形参名显示成合成假名 `arg0/arg1`（源码里没有的名字）；
 *  - 483：带默认值 / rest 的形参**个数**被吞（用运行期 `Function.length` 当声明形参数）；
 *  - 484：带默认值的形参名整个丢失（`b = 2` 的真名 b 不认 → 显示 arg1）。
 *
 * 原生 oracle：声明形参是源码里的名字与个数（`export function f(a, b = 2)` 声明 2 个形参，
 * a / b；`function.length` 按规范不计带默认值 / rest 的形参 ⇒ 不能当声明形参数用）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import {
  evalAbsModuleGraph,
  evalExportsToModuleExports,
  clearAbsModuleCache,
} from "../abs-modules-graph.ts";
import { runTranspiled } from "@nudojs/core";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

const SRC = `export function expDefault(a, b = 2) { return a + b; }
export function expPlain(a, b) { return a + b; }
export function restExp(a, ...more) { return a; }
export function expNamed(alpha, beta) { return alpha + beta; }
function plainDefault(a, b = 2) { return a + b; }
export const arrowDefault = (a, b = 2) => a + b;
export { plainDefault as aliasedDefault };
`;

/** 导出名 → 声明形参名（经模块图桥接的 fn Abs） */
function paramsOf(src: string, dir: string): Map<string, string[]> {
  const file = join(dir, "main.js");
  clearAbsModuleCache();
  const graph = evalAbsModuleGraph(src, file);
  const run = runTranspiled(src, { mode: "analyze", modules: graph.modules as never });
  const exports = evalExportsToModuleExports(run, parse(src), "test");
  const out = new Map<string, string[]>();
  for (const [name, v] of Object.entries(exports.named)) {
    const shape = v.shape as { k?: string; params?: string[] };
    if (shape.k === "fn") out.set(name, shape.params ?? []);
  }
  return out;
}

describe("Bug 463/483/484 跨模块 fn 形参面（声明形参，非假名）", () => {
  it("export function 的形参用源码真名（改前：arg0/arg1）", () => {
    const dir = makeTmpProject("nudo-b463-", { "main.js": SRC });
    const params = paramsOf(SRC, dir);
    expect(params.get("expPlain")).toEqual(["a", "b"]);
    expect(params.get("expNamed")).toEqual(["alpha", "beta"]);
  });

  it("带默认值的形参：名字与个数都在（改前：arg0 一个 / arg1 假名）", () => {
    const dir = makeTmpProject("nudo-b463-", { "main.js": SRC });
    const params = paramsOf(SRC, dir);
    expect(params.get("expDefault")).toEqual(["a", "b"]);
    expect(params.get("plainDefault")).toEqual(["a", "b"]);
    expect(params.get("aliasedDefault")).toEqual(["a", "b"]);
  });

  it("rest 形参计入声明形参数并保留 ... 形态（改前：只剩 1 个）", () => {
    const dir = makeTmpProject("nudo-b463-", { "main.js": SRC });
    const params = paramsOf(SRC, dir);
    expect(params.get("restExp")).toEqual(["a", "...more"]);
  });

  it("负控制：箭头 const 导出的形参面不变", () => {
    const dir = makeTmpProject("nudo-b463-", { "main.js": SRC });
    const params = paramsOf(SRC, dir);
    expect(params.get("arrowDefault")).toEqual(["a", "b"]);
  });
});
