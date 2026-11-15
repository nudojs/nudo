/**
 * Bug 232：数组**非下标键写**被丢弃后读回折成 **exact `undefined`**
 * （原生读回写入值 9）→ 违反引擎自己「不得假精确」的不变式。
 *
 * 写侧（expando 写降级为 arr，值被丢弃）属 S3 分片；本分片修**读面**：
 * arr 形的确定非下标键读不得折 exact undefined，须与字符串键路径同口径
 * 降级为抽象值（unknown）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 引擎的「自信的 undefined」：shape=unknown 令牌 + lit undefined term + exact */
function isExactUndef(r: unknown): boolean {
  const a = r as {
    shape?: { k?: string };
    term?: { op?: string; value?: unknown };
    conf?: string;
  };
  return (
    a?.shape?.k === "unknown" &&
    a.term?.op === "lit" &&
    a.term.value === undefined &&
    a.conf === "exact"
  );
}

describe("Bug 232 — 数组 expando 键读回不得假精确", () => {
  it("负下标写后读回不是 exact undefined（改前是）", () => {
    const r = call(`export function f() { const a=[1,2,3]; a[-1]=9; return a[-1]; }`, "f").result;
    expect(isExactUndef(r)).toBe(false);
  });

  it("非整数下标写后读回不是 exact undefined", () => {
    const r = call(`export function f() { const a=[1,2,3]; a[1.5]=9; return a[1.5]; }`, "f").result;
    expect(isExactUndef(r)).toBe(false);
  });

  it("负控制：闭元组（无 expando 写）的非下标读仍是 exact undefined", () => {
    const r = call(`export function f() { const a=[1,2,3]; return a[-1]; }`, "f").result;
    expect(isExactUndef(r)).toBe(true);
  });

  it("负控制：元组的规范下标读仍是元素值", () => {
    const r = litValue(call(`export function f() { const a=[1,2,3]; return a[0]; }`, "f").result);
    expect(r).toEqual({ ok: true, value: 1 });
  });

  it("负控制：字符串键 expando 路径的既有口径（unknown）不变", () => {
    const r = call(`export function f() { const a=[1,2,3]; a.foo=9; return a.foo; }`, "f").result;
    expect(isExactUndef(r)).toBe(false);
    expect((r as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  });
});
