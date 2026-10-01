/**
 * -0 字面量键同一性回归（literal-identity-negzero / BUG-008）。
 * 回归背景：键/指纹通道用 String(value) 序列化字面量，String(-0)==="0"，
 * numLit(0) 与 numLit(-0) 同键 → flattenSum 去重吞掉 -0；
 * relationFingerprint / generalize L2 instantiateMemoKey 也不保真。
 * joinValues 判「不同字面量」用 Object.is（0/-0 不同），键口径必须与之一致；
 * 展示面（formatShape）早已特判 -0，不在此列。
 */
import { describe, it, expect } from "vitest";
import { absShapeKey, makeSum, joinAbs } from "../objects.ts";
import { relationFingerprint } from "../abs-fn.ts";
import { absKeyInner, instantiateMemoKey } from "../generalize-key.ts";
import { abs, numLit } from "../abs.ts";
import { emptyPhi } from "../pred.ts";
import { formatShape } from "../format.ts";
import { runTranspiled, callTranspiledExportFull } from "@nudojs/core";

const posZero = numLit(0);
const negZero = numLit(-0);

describe("-0 literal identity in key channels", () => {
  it("absShapeKey distinguishes 0 from -0 (stable per value)", () => {
    expect(absShapeKey(posZero)).not.toBe(absShapeKey(negZero));
    expect(absShapeKey(posZero)).toBe(absShapeKey(numLit(0)));
    expect(absShapeKey(negZero)).toBe(absShapeKey(numLit(-0)));
  });

  it("makeSum keeps both 0 and -0 members (flattenSum no longer folds -0)", () => {
    const m = makeSum(negZero, posZero);
    expect(m.shape.k).toBe("sum");
    if (m.shape.k !== "sum") return;
    expect(m.shape.members.length).toBe(2);
    const negFlags = m.shape.members.map((x) =>
      x.term?.op === "lit" && typeof x.term.value === "number" && Object.is(x.term.value, -0),
    );
    expect(negFlags).toContain(true);
    expect(negFlags).toContain(false);
  });

  it("joinAbs(0, -0) keeps the enumeration sum (matches joinValues Object.is)", () => {
    const j = joinAbs(posZero, negZero);
    expect(j.shape.k).toBe("sum");
    if (j.shape.k !== "sum") return;
    expect(
      j.shape.members.map(
        (x) => x.term?.op === "lit" && typeof x.term.value === "number" && Object.is(x.term.value, -0),
      ),
    ).toEqual([false, true]);
  });

  it("identical zeros still dedup to one member", () => {
    expect(joinAbs(posZero, numLit(0)).shape.k).toBe("prim");
    expect(joinAbs(negZero, numLit(-0)).shape.k).toBe("prim");
  });

  it("relationFingerprint distinguishes 0 from -0 param literals", () => {
    const fpPos = relationFingerprint([posZero], numLit(1));
    const fpNeg = relationFingerprint([negZero], numLit(1));
    expect(fpPos).not.toBe(fpNeg);
    expect(relationFingerprint([numLit(0)], numLit(1))).toBe(fpPos);
  });

  it("generalize L2 keys: absKeyInner / instantiateMemoKey distinguish 0 from -0", () => {
    expect(absKeyInner(posZero, new Set())).not.toBe(absKeyInner(negZero, new Set()));
    expect(absKeyInner(posZero, new Set())).toBe(absKeyInner(numLit(0), new Set()));
    const kPos = instantiateMemoKey([posZero], emptyPhi).key;
    const kNeg = instantiateMemoKey([negZero], emptyPhi).key;
    expect(kPos).not.toBe(kNeg);
  });

  it("evaluator: branch join of 0 / -0 keeps both arms (formatShape shows -0)", () => {
    const exports = runTranspiled(
      `export function run(c) { if (c) { return 0; } return -0; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "run", [
      abs({ k: "prim", type: "boolean" }, undefined, undefined, "path"),
    ]);
    const s = formatShape(r.result);
    // 折叠后只剩 "0"；保真应为 0 与 -0 的枚举
    expect(s).toContain("-0");
    expect(s).toContain("0");
  });
});
