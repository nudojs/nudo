/**
 * Bug 407 —— 守卫投影**丢掉 brand 身份** → `ismkDateOutput({})` 返回 `true`
 * （假绿），与 zod / dts / check 三面互相矛盾。
 *
 * 根因：`packages/core/src/algebra/denote.ts` → `denoteShape` 的 `case "brand"`
 * 只递归投影 brand 的**内层 shape**，**不投影 brand 身份**（既无 `instanceof`
 * 也无 brand 名）⇒ 守卫退化成「是个对象即可」（`{}` / `[]` / `new Map()`
 * 全放行）。
 *
 * 修法（族 09 裁决，冻结面内）：`case "brand"` 产出 `globalThis["<Brand>"]`
 * 形态的 `instanceof` 判定；**运行时没有该全局构造器 ⇒ 放行**（与 standard 面
 * 「ctor 找不到 ⇒ 放行」同口径）；构造器按**字符串下标**取（不用裸标识符 ⇒
 * 产物在 strict 工程里不会 TS2304）。
 *
 * 本钉覆盖：① 身份子句的**文本形态**；② 运行时**接受/拒绝**判定；
 * ③ 「构造器不存在 ⇒ 放行」；④ 负控制：不得以裸标识符引用用户类名。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, type Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

/** brand 形态 Abs（内层默认是空槽对象面） */
const brandOf = (name: string, inner?: Abs): Abs =>
  makeAbs(
    {
      k: "brand",
      name,
      shape:
        inner ?? makeAbs({ k: "obj", slots: {} }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    "exact",
  );

/** 把守卫表达式当运行时函数跑（守卫产物的语义面） */
const runner = (g: string): ((v: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (v: unknown) => boolean;

describe("Bug 407 — brand 身份必须被投影进守卫（instanceof 判定）", () => {
  it("brand 臂产出 globalThis[\"<Brand>\"] 形态的 instanceof 判定", () => {
    const g = denoteGuard(brandOf("Date"), "data");
    expect(g).toContain('Reflect.get(globalThis, "Date")');
    // 判定形如 `typeof ctor !== "function" || v instanceof ctor`
    expect(g).toMatch(
      /typeof Reflect\.get\(globalThis, "Date"\) !== "function"/,
    );
    expect(g).toMatch(/instanceof Reflect\.get\(globalThis, "Date"\)/);
  });

  it("运行时：只有该 brand 的实例被放行（`{}` / `[]` / `new Map()` 全拒）", () => {
    const check = runner(denoteGuard(brandOf("Date"), "data"));
    expect(check(new Date(0))).toBe(true);
    expect(check({})).toBe(false);
    expect(check([])).toBe(false);
    expect(check(new Map())).toBe(false);
    expect(check(null)).toBe(false);
    expect(check("x")).toBe(false);
    expect(check(42)).toBe(false);
  });

  it("运行时没有该全局构造器 ⇒ 放行（与 standard 面「ctor 找不到 ⇒ 放行」同口径）", () => {
    const g = denoteGuard(brandOf("Counter"), "data");
    // 身份子句仍然投影（不是「不投影」）
    expect(g).toContain('Reflect.get(globalThis, "Counter")');
    expect(g).toContain("instanceof");
    // 但运行时 globalThis.Counter 不存在 ⇒ 身份子句放行
    const check = runner(g);
    expect(check({})).toBe(true);
    // 内层 shape（对象面）仍然生效 ⇒ 数组仍被排除
    expect(check([])).toBe(false);
  });

  it("负控制：产物不得以裸标识符引用用户类名（否则 TS2304）", () => {
    const g = denoteGuard(brandOf("Counter"), "data");
    expect(g).not.toMatch(/instanceof\s+Counter\b/);
    expect(g).not.toMatch(/instanceof\s+Date\b/);
  });
});
