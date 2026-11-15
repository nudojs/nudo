/**
 * Bug 248 — HOF 回调族（forEach/map/filter/reduce/…）与 `for..of` 用**进体前
 * 快照**的元素表：体内对接收者的变异（`a[1]=9` / `a.length=1` / `a.shift()`）
 * 对后续迭代不可见（陈旧值）；`for..of` 的长度也按进体前快照 ⇒ 迭代期间的
 * push/shift 不可见。
 *
 * 根修：HOF 逐位读**当前容器**（原生 `Get(O,k)` / `HasProperty(O,k)` 逐步
 * 现读）；`for..of` 走数组迭代器的 **live 视图**（`next()` 每步重读长度）。
 *
 * 口径说明（原生事实）：HOF 的 `len` 在**进体前取一次**（`ToLength(O.length)`
 * 只读一次）⇒ 体内 push 不会多跑；少跑靠 `HasProperty` 缺席达成。
 * find/findIndex/findLast/findLastIndex **不查 HasProperty**——hole 位照样
 * 回调（值取 Get ⇒ undefined）。
 *
 * 已知边界（不在本片范围）：体内变异若发生在 **fork 分支**（条件语句）内，
 * 转译层 `$copy` 深拷贝绑定 ⇒ 变异落在副本上，接收者看不到（见报告「剩余
 * 风险」）。本钉覆盖**无条件**变异（绑定不被拷贝 ⇒ 接收者与回调同容器）。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";

const s = (body: string): unknown => {
  const r = call(`export function f() {\n${body}\n}`);
  const t = r.result as { shape?: { k?: string } };
  if (t.shape?.k === "tuple") {
    const els = (r.result as { shape: { elements: unknown[] } }).shape.elements;
    return els.length === 1 ? (els[0] as { term?: { value?: unknown } })?.term?.value : els;
  }
  return (r.result as { term?: { value?: unknown } })?.term?.value;
};

describe("Bug 248 · HOF / for-of 读当前容器（live 元素 + live 长度）", () => {
  it("forEach：体内改写元素值对后续迭代可见（原生 1,9,3）", () => {
    expect(
      s(`const a=[1,2,3]; const out=[]; a.forEach((v,i)=>{ out.push(v); a[1]=9; }); return out.join(",");`),
    ).toBe("1,9,3");
  });

  it("forEach：体内截断长度 ⇒ 缺席位不再回调（原生只剩第 0 位）", () => {
    expect(
      s(`const a=[1,2,3]; const out=[]; a.forEach((v,i)=>{ out.push(v); a.length=1; }); return out.join(",")+"|"+a.length;`),
    ).toBe("1|1");
  });

  it("forEach：体内 shift ⇒ 缺席位跳过（原生 1,3）", () => {
    expect(
      s(`const a=[1,2,3]; const out=[]; a.forEach((v,i)=>{ out.push(v); a.shift(); }); return out.join(",");`),
    ).toBe("1,3");
  });

  it("map / filter / reduce：同样读当前容器", () => {
    expect(
      s(`const a=[1,2,3]; const out=[]; a.map((v,i)=>{ out.push(v); a[1]=9; return v; }); return out.join(",");`),
    ).toBe("1,9,3");
    expect(
      s(`const a=[1,2,3]; const out=[]; a.filter((v,i)=>{ out.push(v); a[1]=9; return true; }); return out.join(",");`),
    ).toBe("1,9,3");
    expect(
      s(`const a=[1,2,3]; const out=[]; a.reduce((acc,v)=>{ out.push(v); a[1]=9; return acc; }, 0); return out.join(",");`),
    ).toBe("1,9,3");
  });

  it("for-of：元素值现读（原生 1,9,3）", () => {
    expect(
      s(`const a=[1,2,3]; const out=[]; for (const v of a) { out.push(v); a[1]=9; } return out.join(",");`),
    ).toBe("1,9,3");
  });

  it("for-of：长度现读——体内 shift 收缩（原生 1,3）", () => {
    expect(
      s(`const a=[1,2,3]; const out=[]; for (const v of a) { out.push(v); a.shift(); } return out.join(",");`),
    ).toBe("1,3");
  });

  it("for-of：长度现读——体内截断（原生只剩 1）", () => {
    expect(
      s(`const a=[1,2,3]; const out=[]; for (const v of a) { out.push(v); a.length=1; } return out.join(",");`),
    ).toBe("1");
  });

  it("对照：无体内变异时行为不变（原生 1,2,3）", () => {
    expect(
      s(`const a=[1,2,3]; const out=[]; a.forEach((v,i)=>{ out.push(v); }); return out.join(",");`),
    ).toBe("1,2,3");
    expect(
      s(`const a=[1,2,3]; const out=[]; for (const v of a) { out.push(v); } return out.join(",");`),
    ).toBe("1,2,3");
  });
});
