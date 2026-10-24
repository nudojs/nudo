/**
 * Bug 1140 —— `@nudo:skip` 签名分支仍输出**旧机器面** ⇒ 机器面与人类面不一致。
 *
 * 位置：packages/core/src/algebra/check.ts 的 `@nudo:skip` 分支——其它签名路径
 * 都用 `formatSigCached`（display = **人类面**渲染 `formatShape`，与终端签名行
 * 逐字同源；detail = 稳定 term id 版），唯独 skip 分支还在用 `formatAbs` /
 * `formatAbsMultiline`（带 `#conf` 段与引擎内部 term 文本）。
 *
 * 现象：`/** @nudo:skip => number() *\/ export function f(){return 1}` 的 JSON
 * `display` 是 `"number  #exact"`，而终端显示 `"number"` ⇒ 同一函数两个面。
 *
 * 修法：skip 分支改用 `formatSigCached(retAbs, name)`（与其它路径同款）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { checkSource, formatShape, pTrue, serializeCheckJson } from "../index.ts";
import type { Abs } from "../abs.ts";
import { resetCheckSourceMemo } from "../check.ts";
import { resetGeneralizeMemo } from "../generalize.ts";
import { resetNudoModuleExecCache, takeRefineDiags } from "../refine.ts";
import { resetSidecarLoadFailureCache, takeInterfaceDiags } from "../interface.ts";
import { resetParseSourceCache } from "../parse-source.ts";
import { resetAbsCallBudget, resetEvalForkBudget } from "../call-budget.ts";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
  resetNudoModuleExecCache();
  resetSidecarLoadFailureCache();
  resetParseSourceCache();
  resetAbsCallBudget();
  resetEvalForkBudget();
  takeRefineDiags();
  takeInterfaceDiags();
});

const numAbs: Abs = { shape: { k: "prim", type: "number" }, conf: "exact" };
/**
 * 带**引擎内部计数器 id** 的项（`len#3` 一族）——编号随进程漂移 ⇒ 不得进对外
 * 载荷（Bug 413 同款：稳定化后应是 `len`）。
 */
const lenAbs: Abs = {
  shape: { k: "prim", type: "number" },
  term: { op: "var", id: "len#3" },
  conf: "exact",
};

/** 终端签名行的返回位渲染（check-report.ts 用 formatShape(abs)） */
function terminalReturn(abs: Abs): string {
  return formatShape(abs);
}

describe("Bug 1140: @nudo:skip 的机器面必须与人类面一致", () => {
  it("JSON display 与终端一致（无 #conf 段）", () => {
    const src = `
/** @nudo:skip => number() */
export function f() {
  return 1;
}
`;
    const report = checkSource("/t/skip.js", src, pTrue, {
      skips: new Map([["f", numAbs]]),
      fromFile: "/t/skip.js",
    });
    const json = serializeCheckJson(report);
    const sig = json.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.display).toBe(terminalReturn(numAbs));
    expect(sig!.display).toBe("number");
    expect(sig!.display).not.toContain("#exact");
    expect(sig!.display).not.toContain("#");
  });

  it("detail 走同一稳定化路径（无引擎内部 term 文本 / 计数器 id）", () => {
    const src = `
/** @nudo:skip => number() */
export function f() {
  return 1;
}
`;
    const report = checkSource("/t/skip2.js", src, pTrue, {
      skips: new Map([["f", lenAbs]]),
      fromFile: "/t/skip2.js",
    });
    const json = serializeCheckJson(report);
    const sig = json.signatures.find((s) => s.name === "f")!;
    // 不得带引擎内部计数器 id（`len#N` 一族 —— 编号随进程漂移 ⇒ 载荷不稳定）
    expect(sig.detail).not.toMatch(/len#\d+/);
    expect(sig.detail).toContain("len");
    // 与其它路径同款：首行函数名 + 形状行 + conf 行
    expect(sig.detail.split("\n")[0]).toBe("f");
    expect(sig.detail).toContain("conf: exact");
  });

  it("未声明返回类型（any）⇒ display 仍是人类面口径", () => {
    const src = `
/** @nudo:skip */
export function h() {
  return 1;
}
`;
    const report = checkSource("/t/skip4.js", src, pTrue, {
      skips: new Map([["h", null]]),
      fromFile: "/t/skip4.js",
    });
    const json = serializeCheckJson(report);
    const sig = json.signatures.find((s) => s.name === "h")!;
    expect(sig.display).toBe("any");
    expect(sig.display).not.toContain("#");
  });
});
