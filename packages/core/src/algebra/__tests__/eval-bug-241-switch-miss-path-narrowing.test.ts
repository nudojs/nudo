/**
 * Bug 241 回归（第二形态）：**非字面量 case 测试**（`case v === null:`）的
 * **miss 路径**未按「该 case 测试不成立」收窄 ⇒ 后续臂（default）里的
 * `v.length` 报 may-throw（L2 假红：原生该路径不抛）。
 *
 * ES 语义（原生）：
 * - `switch (true) { case v === null: …; default: … }`——case 测试是**运行
 *   时求值的表达式**（不是「判别值等于某标签」）：判别值是布尔 true 且测试
 *   是布尔值时，「该臂未命中」⟺「该测试为假」⇒ default 路径上 v **不是**
 *   null（`v.length` 安全）；
 * - 判别值是其它值（false / 数字 / 标识符）时，「未命中」**不**蕴含「测试
 *   为假」⇒ 不产事实（宁缺毋假）。
 *
 * 修复前：miss 路径无收窄 ⇒ default 臂的 `v.length` 报 may-throw（L2 假红）。
 * 修法（transpile/stmt-predicates.ts）：`switchCaseFacts` 为 nullish 比较
 * （`v === null` / `v == null` / `v === undefined`）产出**否定关系**事实
 * （$removeNull / $removeNullish / $removeUndefined），由
 * `narrowCaseLabelArmThunk` 以影子重绑施加到后续臂。
 */
import { describe, it, expect } from "vitest";
import { absLit, type Abs } from "../abs.ts";
import { joinAbs } from "../objects.ts";
import { call, isNever } from "./eval-helpers.ts";

/** 抽象实参 string | null（契约面同形：union(string(), lit(null))） */
const strOrNull: Abs = joinAbs(absLit("ab"), absLit(null));

/** may-throw 面（never = 不抛） */
function mayThrow(src: string, args: Abs[]): boolean {
  const rec = call(src, "f", args);
  return !isNever(rec.throws);
}

describe("Bug 241 — $switch 的 miss 路径按 case 测试收窄（非字面量 case 测试）", () => {
  it("`case v === null:` 的 miss 路径 → default 臂的 v.length 不报 may-throw", () => {
    const src = `export function f(v) {
      switch (true) {
        case v === null:
          return 0;
        default:
          return v.length;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(false);
  });

  it("`case v == null:`（松散）的 miss 路径 → 收窄到非 nullish", () => {
    const src = `export function f(v) {
      switch (true) {
        case v == null:
          return 0;
        default:
          return v.length;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(false);
  });

  it("两个 nullish 比较臂：default 路径排除 null 与 undefined", () => {
    const src = `export function f(v) {
      switch (true) {
        case v === null:
          return 0;
        case v === undefined:
          return 1;
        default:
          return v.length;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(false);
  });

  it("`case v === undefined:` 的 miss 路径只排除 undefined（null 仍在 ⇒ 仍可抛）", () => {
    const src = `export function f(v) {
      switch (true) {
        case v === undefined:
          return 0;
        default:
          return v.length;
      }
    }`;
    // v 可能是 null ⇒ 原生该路径会抛 ⇒ may-throw 是**正确**的（不得过度收窄）
    expect(mayThrow(src, [strOrNull])).toBe(true);
  });

  it("负向比较 `case v !== null:` 的 default 路径 v 仍是 null ⇒ 仍可抛", () => {
    const src = `export function f(v) {
      switch (true) {
        case v !== null:
          return 0;
        default:
          return v.length;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(true);
  });

  it("判别式不是字面量 true 时不产事实（未命中≠测试为假）", () => {
    const src = `export function f(v) {
      switch (v) {
        case v === null:
          return 0;
        default:
          return v.length;
      }
    }`;
    // 原生：v === null 时判别值 null ≠ true ⇒ 走 default ⇒ v.length 抛
    expect(mayThrow(src, [strOrNull])).toBe(true);
  });

  it("收窄不误伤：default 臂读 v 之外的东西不报 may-throw", () => {
    const src = `export function f(v) {
      switch (true) {
        case v === null:
          return 0;
        default:
          return 1;
      }
    }`;
    expect(mayThrow(src, [strOrNull])).toBe(false);
  });
});
