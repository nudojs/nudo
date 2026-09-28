/**
 * serializeCaseArg 数字字面量保真：-0 必须写成 `-0` 往返。
 * 回归背景：`String(-0) === "0"`，旧序列化把 -0 抹成 0，parseCaseArgExpr
 * 读回 +0——Object.is / 1/x 可观察差异丢失。同类：formatShape/termToString
 * 已保真（format-lit-null-negzero），case 指令序列化是同族漏网。
 */
import { describe, it, expect } from "vitest";
import { numLit, litValue } from "@nudojs/core";
import { parseCaseArgExpr } from "@nudojs/parser";
import { serializeCaseArg, buildCaseDirective } from "../case-emitter.ts";

function isNegZero(n: unknown): boolean {
  return typeof n === "number" && Object.is(n, -0);
}

describe("serializeCaseArg keeps -0", () => {
  it("serializes -0 as -0, not 0", () => {
    expect(serializeCaseArg(numLit(-0))).toBe("-0");
  });

  it("still serializes +0 as 0", () => {
    expect(serializeCaseArg(numLit(0))).toBe("0");
  });

  it("round-trips -0 through parseCaseArgExpr", () => {
    const s = serializeCaseArg(numLit(-0))!;
    const back = parseCaseArgExpr(s);
    expect(isNegZero(litValue(back))).toBe(true);
  });

  it("round-trips +0 through parseCaseArgExpr", () => {
    const s = serializeCaseArg(numLit(0))!;
    const back = parseCaseArgExpr(s);
    expect(litValue(back)).toBe(0);
    expect(isNegZero(litValue(back))).toBe(false);
  });

  it("buildCaseDirective round-trips -0 arg", () => {
    const line = buildCaseDirective("negzero", [numLit(-0), numLit(0)]);
    expect(line).toContain("-0");
    expect(line).toContain("0");
    // parse back both args
    const m = line!.match(/\((.*)\)$/);
    expect(m).toBeTruthy();
    const args = m![1]!.split(",").map((s) => parseCaseArgExpr(s.trim()));
    expect(isNegZero(litValue(args[0]!))).toBe(true);
    expect(litValue(args[1]!)).toBe(0);
  });

  it("finite decimals still work", () => {
    expect(serializeCaseArg(numLit(1.5))).toBe("1.5");
    expect(serializeCaseArg(numLit(-3))).toBe("-3");
  });

  it("absStructureKey keeps -0 distinct from +0 (call-record dedupe)", async () => {
    const { absStructureKey } = await import("../../evaluator/call-record.ts");
    expect(absStructureKey(numLit(-0))).not.toBe(absStructureKey(numLit(0)));
    expect(absStructureKey(numLit(-0))).toContain("-0");
    expect(absStructureKey(numLit(0))).toContain(":0");
    expect(absStructureKey(numLit(0))).not.toContain("-0");
  });
});
