/**
 * ADR 0001 阶段 0 · 影子对拍（零行为变更）。
 *
 * 夹具源码逐字固化自 `tmp/bug-report.md`（审计批次 2026-11-14）的主路径形态；
 * 原始报告与 /tmp/** 夹具被 .gitignore 忽略，故本文件是评审与回归的唯一依据。
 *
 * 口径（ADR §7 / §10 决议 4、5）：
 * - 正向断言：新索引**必须**登记每个形态（验证 binder 正确性）；
 * - 影子对拍：只**输出**与旧扫描面的分歧清单，不修行为、不设失败门槛、
 * **不设白名单**；旧面结论一律不作修改。
 * - 范围：仅 ESM / CJS 主路径（/004/015/016/017/023/024/032）；
 * namespace / .ts 参数属性留阶段 1。
 */
import { describe, it, expect } from "vitest";
import { parseSource, resetParseSourceCache } from "../parse-source.ts";
import { listTopFunctions, listClassEntryNames } from "../scan/scan-top-functions.ts";
import {
  buildSemanticIndex,
  resolveBindingAt,
  lexicalKindAt,
  resetSemanticIndexCache,
} from "../scan/semantic-index.ts";

interface Fixture {
  /** bug-report.md 的编号（只作清单标签，不是豁免白名单）。 */
  id: string;
  source: string;
  entries: readonly string[];
  slots?: readonly string[];
}

const FIXTURES: readonly Fixture[] = [
  {
    id: "BUG-002",
    source: `function boom() { throw new Error("boom"); }
exports.greet = boom;`,
    entries: ["boom"],
    slots: ["exports.greet"],
  },
  {
    id: "BUG-015a",
    source: `export const { a } = { a: () => null.x };`,
    entries: ["a"],
    slots: ["a"],
  },
  {
    id: "BUG-015b",
    source: `export const [a] = [() => null.x];`,
    entries: ["a"],
    slots: ["a"],
  },
  {
    id: "BUG-016",
    source: `export default { m() { return null.x; } };`,
    entries: ["m"],
    slots: ["default"],
  },
  {
    id: "BUG-017",
    source: `export default class { m() { return null.x; } }`,
    entries: ["default.m"],
    slots: ["default"],
  },
  {
    id: "BUG-023a",
    source: `class C {
  constructor() { throw new TypeError("no ctor"); }
  m() { return null.x; }
}
module.exports = C;`,
    entries: ["C", "C.m"],
    slots: ["module.exports"],
  },
  {
    id: "BUG-023b",
    source: `exports.C = class C { m() { return null.x; } };`,
    entries: ["C", "C.m"],
    slots: ["exports.C"],
  },
  {
    id: "BUG-024a",
    source: `const C = class { m() { return null.x; } };
export { C };`,
    entries: ["C", "C.m"],
    slots: ["C"],
  },
  {
    id: "BUG-024b",
    source: `const C = class { constructor() { throw new TypeError("no ctor"); } };
export default C;`,
    entries: ["C"],
    slots: ["default"],
  },
  {
    id: "BUG-004/032",
    source: `export class K { m(a) { return a; } }
const c = new K();
export function tplKey() { return c[\`m\`](-1); }
export function optMember() { return c?.m(-1); }
export function optCall() { return c.m?.(-1); }`,
    entries: ["tplKey", "optMember", "optCall"],
  },
];

function indexOf(source: string) {
  return buildSemanticIndex(parseSource(source));
}

describe("SemanticIndex · 阶段 0 骨架", () => {
  it.each(FIXTURES)("$id 登记入口与导出槽", (f) => {
    const idx = indexOf(f.source);
    for (const e of f.entries) {
      expect(idx.entries, `${f.id} 应登记入口 ${e}，实际 ${idx.entries.join(",")}`).toContain(e);
    }
    for (const s of f.slots ?? []) {
      expect([...idx.exportSlots.keys()], `${f.id} 应登记导出槽 ${s}`).toContain(s);
    }
  });

  it("控制夹具：旧扫描面逐字不变（零行为变更）", () => {
    const src = `export function f() { return 1; }`;
    expect(listTopFunctions(src)).toEqual(["f"]);
    expect(listClassEntryNames(src)).toEqual([]);
    expect(indexOf(src).entries).toEqual(["f"]);
  });

  it("稳定键：跨 parse 重建产生同一组 SymbolId（决议 1）", () => {
    const src = `export const x = 1; export function f(y) { return y + x; }`;
    resetParseSourceCache();
    const first = indexOf(src);
    resetParseSourceCache();
    resetSemanticIndexCache();
    const second = indexOf(src);
    expect([...first.symbols.keys()].sort()).toEqual([...second.symbols.keys()].sort());
  });

  it("按身份解析：形参遮蔽模块级 const 时不回落到外层（BUG-003）", () => {
    const src = `const LIMIT = -1;
export function f(LIMIT) { return g(LIMIT); }`;
    const idx = indexOf(src);
    const offset = src.indexOf("g(LIMIT)") + 2;
    const paramId = resolveBindingAt(idx, "LIMIT", offset);
    expect(paramId).toBeDefined();
    expect(idx.symbols.get(paramId!)?.kind).toBe("param");
    const moduleId = [...idx.symbols.values()].find(
      (s) => s.name === "LIMIT" && s.kind === "const",
    )?.id;
    expect(moduleId).toBeDefined();
    expect(paramId).not.toBe(moduleId);
  });

  it("词法区间按 offset 查询，续行仍属模板字面量（BUG-019 判据基础）", () => {
    const src = "export const msg = `first line\nmodObj.`;\nexport const n = 1;";
    const idx = indexOf(src);
    expect(lexicalKindAt(idx, src.indexOf("modObj") + 1)).toBe("template");
  });

  it("调用点：可选链与静态模板键都登记（BUG-032 / BUG-004）", () => {
    const fixture = FIXTURES.find((f) => f.id === "BUG-004/032")!;
    const idx = indexOf(fixture.source);
    expect(idx.calls.filter((c) => c.optional)).toHaveLength(2);
    expect(idx.calls.filter((c) => c.memberKey === "m")).toHaveLength(3);
  });

  it("影子对拍：输出与旧扫描面的分歧清单（不修行为、不设门槛、不设白名单）", () => {
    const rows = FIXTURES.map((f) => {
      const idx = indexOf(f.source);
      const oldEntries = [...new Set([
        ...listTopFunctions(f.source),
        ...listClassEntryNames(f.source),
      ])];
      const missingInOld = idx.entries.filter((e) => !oldEntries.includes(e));
      return {
        bug: f.id,
        old: oldEntries,
        indexed: idx.entries,
        slots: [...idx.exportSlots.keys()],
        missingInOld,
      };
    });
    // 只输出清单：分歧内容不参与相等断言 ⇒ 不设 CI 失败门槛、不设白名单。
    console.info(
      "[semantic-index shadow diff]\n" + rows.map((r) =>
        `${r.bug.padEnd(11)} old=[${r.old.join(",")}] indexed=[${r.indexed.join(",")}] slots=[${r.slots.join(",")}] +[${r.missingInOld.join(",")}]`,
      ).join("\n"),
    );
    expect(rows.some((r) => r.missingInOld.length > 0)).toBe(true);
  });
});
