/**
 * Bug 58 —— `@nudo:mock` 在 `test` / `export` 面跨函数泄漏（同文件未声明该
 * mock 的函数也被替换）⇒ 伪造见证 + 错误 d.ts，而 `check` 面正确。
 *
 * 根因：作用域覆盖表（`MOCK_SCOPE_OVERRIDES`）只为**重名冲突**而建；单条
 * mock 只落在平表里 ⇒ `mockScopeSelected` 无覆盖时直接返回平表（全文件可见）。
 * 产品面注入的平表经 `tryEvalCallFull` 调 `mockScopeSelected` 时按「文件级」
 * 放行 ⇒ 未声明函数也拿到 mock。
 *
 * 修法：`mockSeedsToAbsMocks` 附带**全量**作用域声明表（`MOCK_SCOPE_DECLS`）；
 * `mockScopeSelected` 据此按词法作用域过滤（与 check 面 `scopeSelectedInject`
 * 同口径）：被某函数声明过的 mock 名只在该函数作用域里保留。无函数级声明
 * （手工 inject / 故意声明为文件级）时不挂表 ⇒ 既有「文件级可见」不破坏。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { absLit } from "@nudojs/core/internal";
import { parse, extractDirectivesQuiet } from "@nudojs/parser";
import {
  mockDirectivesToAbsSeeds,
  mockSeedsToAbsMocks,
  mockScopeDeclsOf,
  mockScopeOverridesOf,
  mockScopeSelected,
} from "../mock-abs.ts";
import { analyzeFileAsync } from "../analyzer.ts";

/** 单个 mock 声明在 onlyA；onlyB 未声明（改前 onlyB 被伪造成 42） */
const ONE_MOCK = `/**
 * @nudo:mock remote = () => 42
 */
export function onlyA() { return remote(); }
export function onlyB() { return remote(); }`;

/** 两个函数各声明同名 mock（Bug 455 冲突场景，必须仍各取各的） */
const TWO_MOCKS = `/**
 * @nudo:mock getPort = stub().returns(8080)
 */
export function readA() { return getPort(); }
/**
 * @nudo:mock getPort = stub().returns("closed")
 */
export function readB() { return getPort(); }`;

function seedsOf(source: string, fromFile: string) {
  return mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile });
}

describe("Bug 58 — 单条 @nudo:mock 只在声明函数内生效", () => {
  it("全量作用域声明表随表流转；无冲突时重名覆盖表仍为空（既有钉不回归）", () => {
    const mocks = mockSeedsToAbsMocks(seedsOf(ONE_MOCK, "/tmp/bug58-a.js"));
    const decls = mockScopeDeclsOf(mocks);
    expect(decls && Object.keys(decls)).toEqual(["onlyA"]);
    expect(decls?.onlyA && Object.keys(decls.onlyA)).toEqual(["remote"]);
    expect(mockScopeOverridesOf(mocks)).toBeUndefined();
  });

  it("mockScopeSelected：声明函数看得到，未声明函数看不到", () => {
    const mocks = mockSeedsToAbsMocks(seedsOf(ONE_MOCK, "/tmp/bug58-b.js"));
    expect(mockScopeSelected(mocks, "onlyA").remote).toBeDefined();
    expect(mockScopeSelected(mocks, "onlyB").remote).toBeUndefined();
  });

  it("产品面 analyzeFileAsync：onlyA=42、onlyB=never throws ReferenceError", async () => {
    const res = await analyzeFileAsync("/tmp/bug58-product.js", ONE_MOCK);
    const valueOf = (name: string): unknown => {
      const fn = res.functions.find((f) => f.name === name);
      expect(fn, `function ${name} missing`).toBeDefined();
      const lit = litValue(fn!.combinedAbs!);
      return lit.ok ? lit.value : fn!.combinedAbs!.shape.k;
    };
    expect(valueOf("onlyA")).toBe(42);
    expect(valueOf("onlyB")).toBe("never");
  });

  it("无函数级声明（文件级 / 手工 inject）仍全文件可见（既有行为不破坏）", () => {
    const mocks = mockSeedsToAbsMocks({ seedVars: { remote: absLit(42) }, seedFns: {} });
    expect(mockScopeDeclsOf(mocks)).toBeUndefined();
    expect(mockScopeSelected(mocks, "anyFn").remote).toBeDefined();
  });

  it("Bug 455 不回归：同名冲突按作用域各取各的", () => {
    const mocks = mockSeedsToAbsMocks(seedsOf(TWO_MOCKS, "/tmp/bug58-c.js"));
    const a = mockScopeSelected(mocks, "readA");
    const b = mockScopeSelected(mocks, "readB");
    expect(a.getPort).toBeDefined();
    expect(b.getPort).toBeDefined();
    expect(a.getPort).not.toBe(b.getPort);
  });
});
