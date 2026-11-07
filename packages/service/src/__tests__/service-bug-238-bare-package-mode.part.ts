/**
 * BUG-238 回归：裸包的**消费形态**（ESM `import` / CJS `require`）必须透传到
 * `exports` 条件解析——dual package 的 `require` 消费方要拿 `require` 构建。
 *
 * 改前 `importSpecs` 把说明符压成 `string[]`（形态在类型上就消失）⇒ 一律按
 * auto 顺序先试 `import` ⇒ require 消费方被解析到 ESM 构建 ⇒ 与宿主结论相反。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { evalAbsModuleGraph, clearAbsModuleCache } from "../abs-modules-graph.ts";
import { tmpProject } from "./tmp-project.ts";

function project(): string {
  return tmpProject("nudo-238-", {
    "node_modules/dualpkg/package.json": JSON.stringify({
      name: "dualpkg",
      version: "1.0.0",
      exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs" } },
    }),
    "node_modules/dualpkg/esm.mjs": 'export const kind = "esm";\n',
    "node_modules/dualpkg/cjs.cjs": 'exports.kind = "cjs";\n',
  });
}

/** 消费方的 modules 表里裸包入口导出的 `kind`（字符串 Abs 的显示形态）。 */
function kindSeenBy(dir: string, file: string, source: string): string {
  const graph = evalAbsModuleGraph(source, join(dir, file), {});
  const mod = graph.modules["dualpkg"];
  expect(mod).toBeDefined();
  const kind = mod!.named["kind"];
  expect(kind).toBeDefined();
  return formatShape(kind!);
}

beforeEach(() => {
  clearAbsModuleCache();
});

describe("BUG-238 — 裸包消费形态透传", () => {
  it("require 消费方 ⇒ 取 exports.require 构建", () => {
    const dir = project();
    const src = 'const { kind } = require("dualpkg");\nmodule.exports = { kind };\n';
    expect(kindSeenBy(dir, "consumer.cjs", src)).toBe('"cjs"');
  });

  it("import 消费方 ⇒ 取 exports.import 构建（对照组）", () => {
    const dir = project();
    const src = 'import { kind } from "dualpkg";\nexport const k = kind;\n';
    expect(kindSeenBy(dir, "consumer.mjs", src)).toBe('"esm"');
  });
});
