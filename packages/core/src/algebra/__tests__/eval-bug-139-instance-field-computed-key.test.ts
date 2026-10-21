/**
 * Bug 139 回归：实例字段的**计算键**求值时机/次数。
 *
 * ES 语义（ClassDefinitionEvaluation → ClassFieldDefinitionEvaluation）：
 * 计算属性键 `class A { [k()] = 1 }` 的键表达式在**类定义期**求值**一次**，
 * 构造期只按已定键安装字段（InitializeInstanceElements）。
 *
 * 修复前：键表达式编成实例字段的 `key` thunk（逐实例求值）——定义期 0 次、
 * 每构造 1 次；键可能每次不同 ⇒ 字段名漂移（两次构造得到两个键），且
 * 定义期副作用（计数器/抛错）缺失。
 *
 * 不变量（负控制钉住）：静态字段/方法的计算键仍各求值 1 次（定义期），
 * 公有实例字段不受影响。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : t.shape.k;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 139 — 实例字段计算键：定义期求值一次", () => {
  it("键表达式在类定义期求值 1 次（此前 0 次）", () => {
    expect(
      v(wrap(`let n = 0; function k(){ n++; return "x"; } class A { [k()] = 1; } return n;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("多次构造不再重复求值键（此前每构造 1 次）", () => {
    expect(
      v(
        wrap(
          `let n = 0; function k(){ n++; return "x"; } class A { [k()] = 1; } new A(); new A(); new A(); return n;`,
        ),
      ),
    ).toEqual({ ok: true, value: 1 });
  });

  it("键不再随实例漂移（两次构造同键）", () => {
    expect(
      v(
        wrap(
          `let n = 0; function k(){ n++; return "f"+n; } class A { [k()] = n; } const a = new A(), b = new A(); return Object.keys(a).join(",")+"|"+Object.keys(b).join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "f1|f1" });
  });

  it("键表达式的抛错在定义期表面（构造期不再抛）", () => {
    expect(
      v(
        wrap(
          `let hits = 0; function k(){ if (hits++ > 0) throw new Error("second"); return "m"; } class A { [k()] = 1; } new A(); try { new A(); return "no-throw"; } catch (e) { return "threw:" + e.constructor.name; }`,
        ),
      ),
    ).toEqual({ ok: true, value: "no-throw" });
  });

  it("同名类在两处定义：每次定义各求值 1 次", () => {
    expect(
      v(
        wrap(
          `let n = 0; function k(){ n++; return "x"; } function make(){ class A { [k()] = 1; } return A; } make(); make(); return n;`,
        ),
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：静态字段/方法的计算键仍各求值 1 次", () => {
    expect(
      v(wrap(`let n = 0; function k(){ n++; return "x"; } class A { static [k()] = 1; } return n;`)),
    ).toEqual({ ok: true, value: 1 });
    expect(
      v(wrap(`let n = 0; function k(){ n++; return "x"; } class A { [k()](){ return 1; } } return n;`)),
    ).toEqual({ ok: true, value: 1 });
  });

  it("负控制：公有实例字段的键与值不变", () => {
    expect(v(wrap(`class A { pub = 7; } return new A().pub;`))).toEqual({ ok: true, value: 7 });
  });

  it("负控制：抽象计算键不假精确挂名（不抛）", () => {
    // 键是未知的入参（抽象键）——不可静态命名 → 字段不挂名（不假精确）
    expect(throwName(`export function f(x) { class A { [x] = 1; } return 1; }`)).toBe("");
  });
});
