/**
 * Bug 24：契约 lit(null) / nullable() 的 entry Abs 编码。
 *
 * 回归背景：constraintOnTermAbs 的 allEqNullish 分支产出裸
 * `{k:"unknown"}` + 参数项 var（无 lit term）——formatShape 渲染
 * "unknown"、`!== null` 守卫剪不掉成员、算术落保守并集：
 *   sig(v: number | unknown) => number | unknown
 *   guardAdd → number | string | 0（不可能 string 臂）
 *   guardRel → 假 L2 may-throw
 * 修复：与对象 union 的 nullish 成员同款编码——shape unknown +
 * term lit(null/undefined)（formatShape 渲染 "null"/"undefined"、
 * $removeNull/$removeNullish/strictEq 按 term 识别）。同时不回归
 * 「lit(undefined) 契约不得投成 number」的既有动机
 * （lit-undef-constraint-not-number.test.ts）。
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  pTrue,
  constraintToEntryAbs,
  formatShape,
  leqAbs,
  num,
  number,
  lit,
  litC,
  nullable,
  union,
  abs,
} from "../index.ts";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function issuesOf(src: string) {
  return checkSource("/t/nullish.js", withStdImport(src), pTrue, stdOpts);
}

describe("constraintOnTermAbs nullish encoding (Bug 24, unit)", () => {
  it("litC(null) entry Abs = unknown shape + term lit(null), renders null", () => {
    const a = constraintToEntryAbs(litC(null) as never, "v");
    expect(a.shape.k).toBe("unknown");
    expect(a.term?.op === "lit" && a.term.value === null).toBe(true);
    expect(formatShape(a)).toBe("null");
  });

  it("litC(undefined) entry Abs renders undefined (motive kept: not number)", () => {
    const a = constraintToEntryAbs(litC(undefined) as never, "v");
    expect(formatShape(a)).toBe("undefined");
    expect(a.shape.k === "prim").toBe(false);
    expect(leqAbs(a, num()).ok).toBe(false);
  });

  it("union(number(), lit(null)) keeps a decodable null member", () => {
    const a = constraintToEntryAbs(union(number(), litC(null)) as never, "v");
    expect(formatShape(a)).toBe("number | null");
    if (a.shape.k !== "sum") throw new Error("expected sum");
    const nullMember = a.shape.members.find((m) => m.term?.op === "lit");
    expect(nullMember?.term && (nullMember.term as { value: unknown }).value === null).toBe(true);
    // 与对象 union null 成员同构（absShapeKey/剪枝/strictEq 消费同一表示）
    expect(
      leqAbs(abs({ k: "unknown" }, lit(null), undefined, "exact"), nullMember!).ok,
    ).toBe(true);
  });

  it("nullable(number()) renders number | null | undefined (nullish 显式化)", () => {
    const a = constraintToEntryAbs(nullable(number()) as never, "v");
    expect(formatShape(a)).toBe("number | null | undefined");
  });
});

describe("nudo check: numOrNull contract signatures (Bug 24, four symptoms)", () => {
  it("sig: signature displays number | null (not unknown)", () => {
    const r = issuesOf(`
/** @nudo:contract v numOrNull */
export function sig(v) { return v; }
`);
    const s = r.signatures.find((x) => x.name === "sig")!;
    expect(s.display).toContain("number | null");
    expect(s.display).not.toContain("unknown");
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
  });

  it("guardRet: `!== null` prunes the null arm → number | 0", () => {
    const r = issuesOf(`
/** @nudo:contract v numOrNull */
export function guardRet(v) { if (v !== null) { return v; } return 0; }
`);
    const s = r.signatures.find((x) => x.name === "guardRet")!;
    expect(s.display.replace(/\s+/g, "")).not.toContain("null");
    expect(s.display).toContain("number");
  });

  it("guardAdd: null-pruned arithmetic has no impossible string arm", () => {
    const r = issuesOf(`
/** @nudo:contract v numOrNull */
export function guardAdd(v) { if (v !== null) { return v + 1; } return 0; }
`);
    const s = r.signatures.find((x) => x.name === "guardAdd")!;
    expect(s.display).not.toContain("string");
    expect(s.display).not.toContain("throws");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("guardRel: `v !== null && v > 0` records no L2 may-throw", () => {
    const r = issuesOf(`
/** @nudo:contract v numOrNull */
export function guardRel(v) { if (v !== null && v > 0) { return v; } return 0; }
`);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    const s = r.signatures.find((x) => x.name === "guardRel")!;
    expect(s.display).not.toContain("throws");
    expect(s.display).not.toContain("string");
  });

  it("nullableSig: nullable(number()) also displays decodable nullish members", () => {
    const r = issuesOf(`
/** @nudo:contract v nullableNum */
export function nullableSig(v) { return v; }
`);
    const s = r.signatures.find((x) => x.name === "nullableSig")!;
    expect(s.display).not.toContain("unknown");
    expect(s.display).toContain("null");
  });

  it("bare lit(null) param is value evidence, not unknown-inference debt", () => {
    const r = issuesOf(`
/** @nudo:contract v posOrNull */
export function litOnly(v) { return v; }
`);
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
  });

  it("contract gate intact: violating numOrNull still errors (L1)", () => {
    const r = issuesOf(`
/** @nudo:contract v numOrNull */
export function bad(v) { return v + "!"; }
`);
    // may-throw 记录不变（unknown 令牌 wave-1 口径，非本 bug 范围）；
    // 但契约违例执法通道必须仍在。
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw").length).toBe(1);
  });
});
