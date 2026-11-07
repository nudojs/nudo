/**
 * Bug 457：JSON 依赖（`.json`）——此前一律当 JS 转译（`{"a": 1}` 不是合法 JS
 * 表达式语句）→ fail-closed 空导出表且**零诊断** ⇒ 值被静默丢弃。
 *
 * 原生 oracle（node）：
 *   - `require("./data.json").a` → 1；
 *   - `import d from "./data.json"`（带 import attribute）→ d.a → 1；
 *   - `import { a } from "./data.json"` → 原生报错（JSON 模块没有具名导出）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { evalAbsModuleGraph, clearAbsModuleCache } from "../abs-modules-graph.ts";
import { runTranspiled, callTranspiledExportFull } from "@nudojs/core";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

const DATA = `{"a": 1, "b": "x"}\n`;

function callGetA(dir: string, src: string): { value: unknown; issues: string[] } {
  const file = join(dir, "main.js");
  clearAbsModuleCache();
  const graph = evalAbsModuleGraph(src, file);
  const run = runTranspiled(src, { mode: "analyze", modules: graph.modules as never });
  const r = callTranspiledExportFull(run, "getA", []);
  return { value: r.result.term, issues: graph.issues.map((i) => `${i.kind}: ${i.label}`) };
}

describe("Bug 457 JSON 依赖装载", () => {
  it("require(\"./data.json\") 取到真实值（改前：unknown）", () => {
    const dir = makeTmpProject("nudo-b457-", { "data.json": DATA });
    const src = `const d = require("./data.json");
export function getA() { return d.a; }
`;
    const { value } = callGetA(dir, src);
    expect(value).toEqual({ op: "lit", value: 1 });
  });

  it("import default 取到整个文档（改前：unknown）", () => {
    const dir = makeTmpProject("nudo-b457-", { "data.json": DATA });
    const src = `import d from "./data.json";
export function getA() { return d.a; }
`;
    const { value } = callGetA(dir, src);
    expect(value).toEqual({ op: "lit", value: 1 });
  });

  it("JSON 具名导入给出明确缺名诊断（原生同样报错；改前：静默 unknown）", () => {
    const dir = makeTmpProject("nudo-b457-", { "data.json": DATA });
    const src = `import { a } from "./data.json";
export function getA() { return a; }
`;
    const { issues } = callGetA(dir, src);
    expect(issues.some((i) => i.startsWith("missing-export"))).toBe(true);
  });

  it("非法 JSON 不再静默丢值（给出明确装载问题）", () => {
    const dir = makeTmpProject("nudo-b457-", { "data.json": "{ not json" });
    const src = `const d = require("./data.json");
export function getA() { return d.a; }
`;
    const { issues } = callGetA(dir, src);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("非法 JSON 走**专用**诊断形态（json-invalid），不折叠成 missing", () => {
    // 「JSON 语法错」与「文件不存在」是两种形态 ⇒ 专用 kind（诊断码
    // nudo:json-invalid；core 的 DIAG 注册表待补——越界上报）。
    const dir = makeTmpProject("nudo-b457-bad-", { "data.json": "{ not json" });
    const src = `const d = require("./data.json");
export function getA() { return d.a; }
`;
    const { issues } = callGetA(dir, src);
    expect(issues.some((i) => i.startsWith("json-invalid"))).toBe(true);
    expect(issues.some((i) => i.startsWith("missing"))).toBe(false);
  });

  it("负控制：普通 JS 依赖装载不受影响", () => {
    const dir = makeTmpProject("nudo-b457-", {
      "mod.js": `export const a = 7;\n`,
    });
    const src = `import { a } from "./mod.js";
export function getA() { return a; }
`;
    const { value, issues } = callGetA(dir, src);
    expect(value).toEqual({ op: "lit", value: 7 });
    expect(issues).toEqual([]);
  });
});
