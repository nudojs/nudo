/**
 * BUG-070 回归：「见证名 = 调用点身份」必须在**同一行多个调用点**时仍成立。
 *
 * 改前本地调用点只有行号维度 ⇒ 同一行两个调用点都叫 `call@L6` ⇒ 一个现场的
 * 见证凭空消失（声明了其中一个后另一个的观测真值被吞）。
 */
import { describe, it, expect } from "vitest";
import { numLit } from "@nudojs/core";
import { disambiguateCallsiteNames, callsiteCaseName } from "../analyzer-orchestrate-uncached-cases.ts";
import { neverAbs, type CallRecord } from "../evaluator/call-record.ts";

const FILE = "/proj/usage.js";

function rec(line: number, column: number, arg: number): CallRecord {
  return {
    fnName: "add",
    argAbs: [numLit(arg)],
    resultAbs: numLit(arg + 1),
    throwsAbs: neverAbs,
    callLoc: { line, column },
  };
}

describe("BUG-070 — 同行多调用点的见证名唯一", () => {
  it("同一行两个调用点 ⇒ 名字不同（加列维度），且各自可核对到列", () => {
    const names = disambiguateCallsiteNames([rec(6, 0, 1), rec(6, 9, 3)], FILE, 1);
    expect(new Set(names).size).toBe(2);
    // 撞名的两条**都**带列维度（同一行 ⇒ 谁的「裸名」都不该独占）
    expect(names[0]).toBe("call@L6C0");
    expect(names[1]).toBe("call@L6C9");
  });

  it("对照组：唯一调用点的名字格式不变（既有固化见证不漂移）", () => {
    expect(disambiguateCallsiteNames([rec(6, 0, 1)], FILE, 1)).toEqual(["call@L6"]);
    expect(callsiteCaseName(rec(6, 0, 1), FILE, 1)).toBe("call@L6");
  });

  it("三个及以上同行调用点：列缺失时退回序号（仍唯一）", () => {
    const r1 = { ...rec(6, 0, 1), callLoc: undefined } as CallRecord;
    const r2 = { ...rec(6, 0, 2), callLoc: undefined } as CallRecord;
    const names = disambiguateCallsiteNames([r1, r2], FILE, 6);
    expect(new Set(names).size).toBe(2);
  });
});
