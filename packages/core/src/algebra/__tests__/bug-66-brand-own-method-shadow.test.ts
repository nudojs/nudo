/**
 * Bug 66 回归：[[Get]] 是 **own → prototype**。内置 brand 实例 / 数组上的
 * `a.push = 1` 确实建了自有槽，读面不得再被原型方法表（BUILTIN_BRAND_METHODS /
 * ARRAY_PROTO_METHOD_NAMES）顶掉。此前 typeof a.push 恒折 "function"。
 */
import { describe, it, expect } from "vitest";
import { val, call } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 66 — own 属性遮蔽原型方法", () => {
  it("数组 a.push = 1 读回 1（改前折函数）", () => {
    expect(val(wrap(`const a = []; a.push = 1; return a.push;`))).toEqual({ ok: true, value: 1 });
    expect(val(wrap(`const a = []; a.push = 1; return typeof a.push;`))).toEqual({ ok: true, value: "number" });
  });

  it("Map 实例 m.get = 1 读回 number", () => {
    expect(val(wrap(`const m = new Map(); m.get = 1; return typeof m.get;`))).toEqual({ ok: true, value: "number" });
  });

  it("Date / Set / RegExp 实例同形态", () => {
    for (const [init, key] of [
      [`new Date(0)`, "getTime"],
      [`new Set()`, "add"],
      [`/a/`, "test"],
    ] as const) {
      expect(val(wrap(`const o = ${init}; o.${key} = 1; return typeof o.${key};`)), key).toEqual({
        ok: true,
        value: "number",
      });
    }
  });

  it("非表内键保持既有 unknown 口径（不假精确）；未写时表内键仍折函数", () => {
    const r = call(wrap(`const a = [1,2,3]; a.zzz = 1; return a.zzz;`));
    expect(r.result.shape.k).toBe("unknown");
    expect(val(wrap(`const a = [1,2]; return typeof a.push;`))).toEqual({ ok: true, value: "function" });
  });
});
