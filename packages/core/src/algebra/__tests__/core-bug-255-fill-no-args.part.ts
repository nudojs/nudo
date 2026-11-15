/**
 * Bug 255 — `Array.prototype.fill()` **无实参**：整条 fill 分支被跳过（守卫
 * `args.length >= 1`），数组原样保留（原生整数组被填成 `undefined`、
 * length 不变）。
 *
 * 根修：去掉零实参守卫；fill 的 value 缺省按原生取 `undefined`
 * （`ToIntegerOrInfinity` 之外的缺省语义：`fill(value = undefined)`）。
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

const val = (body: string): unknown => {
  const r = call(`export function f() {\n${body}\n}`);
  return (r.result as { term?: { op?: string; value?: unknown } })?.term?.value;
};

const shape = (body: string): string => formatShape(call(`export function f() {\n${body}\n}`).result);

describe("Bug 255 · fill() 零实参", () => {
  it("fill() 把整条数组填成 undefined（长度不变）", () => {
    // 原生 [0,1,2,3].fill() → [undefined, undefined, undefined, undefined]
    // 引擎的 undefined 元素面 = lit undefined（确定 undefined，非裸 unknown）
    expect(shape(`const a=[0,1,2,3]; a.fill(); return a;`)).toBe(
      "[undefined, undefined, undefined, undefined]",
    );
    expect(val(`const a=[0,1,2,3]; a.fill(); return a.length;`)).toBe(4);
  });

  it("fill() 的第 0 位不再是原值 0", () => {
    expect(shape(`const a=[0,1,2,3]; a.fill(); return a[0];`)).toBe("undefined");
    expect(shape(`const a=[0,1,2,3]; a.fill(); return a[3];`)).toBe("undefined");
  });

  it("对照：fill(value) 语义不变", () => {
    expect(val(`const a=[0,1,2,3]; a.fill(7); return a.join(",");`)).toBe("7,7,7,7");
    expect(val(`const a=[0,1,2,3]; a.fill(7,1,3); return a.join(",");`)).toBe("0,7,7,3");
  });
});
