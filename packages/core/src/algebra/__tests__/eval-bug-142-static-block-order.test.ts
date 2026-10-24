/**
 * Bug 142 回归：static 块与静态字段初始化器的**类体源码顺序**。
 *
 * ES 语义（ClassDefinitionEvaluation → InitializeStaticElements）：静态元素
 * （静态字段初始化器 + static 块）按**类体源码顺序**依次执行。
 *
 * 修复前：静态块恒在**全部**静态字段初始化器之后（两块分表：静态字段进
 * statics 表由 $class 求值，static 块另走 $staticInit 尾段）——类体源码
 * 顺序丢失：`class A { static { A.q = 1 } static r = A.q + 1 }` 原生 r=2，
 * 引擎折 NaN（q 未定义）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 142 — static 块与静态字段按源码顺序执行", () => {
  it("static 块在前的静态字段读到块内写入（原生 2）", () => {
    expect(
      v(wrap(`class A { static { A.q = 1; } static r = A.q + 1; } return A.r;`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it("字段-块-字段三段交错（原生 3）", () => {
    expect(
      v(
        wrap(
          `class A { static r = 1; static { A.s = 2; } static t = A.r + A.s; } return A.t;`,
        ),
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it("副作用轨迹按源码序（原生 1b2）", () => {
    expect(
      v(
        wrap(
          `let log = ""; class A { static a = log += "1"; static { log += "b"; } static c = log += "2"; } return log;`,
        ),
      ),
    ).toEqual({ ok: true, value: "1b2" });
  });

  it("负控制：字段在前的 static 块读前序字段（原生 2）", () => {
    expect(
      v(wrap(`class A { static n = 1; static { A.m = A.n + 1; } } return A.m;`)),
    ).toEqual({ ok: true, value: 2 });
  });

  it("负控制：static 块写外层变量仍在定义期落地", () => {
    expect(
      v(wrap(`let y = 0; class C { static { y = 5; } } return y;`)),
    ).toEqual({ ok: true, value: 5 });
  });

  it("负控制：static 块内 this 是类值（写入落槽）", () => {
    expect(
      v(wrap(`class S { static t = 0; static { this.t = 5; } } return S.t;`)),
    ).toEqual({ ok: true, value: 5 });
  });
});
