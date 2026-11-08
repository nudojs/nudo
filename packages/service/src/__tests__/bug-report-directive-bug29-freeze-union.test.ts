/**
 * Bug 29 —— `test --freeze` 把**自己解析不了**的 `union(...)` 写进源码
 * （数组 / 对象 / `Infinity` 成员）⇒ 见证永久退化 unknown。
 *
 * 根因：`sum` 成员按 case 实参文法里的**字面量**形态递归序列化
 * ⇒ `union([2], { k: 3 })`（成员是数组 / 对象 ⇒ `union()` 执行时
 * `asNestedConstraint` 直接 throw）与 `union(Infinity, -0)`（`Infinity`
 * 裸标识符进不了解析侧安全白名单）两类非法指令。
 *
 * 修法：成员改**约束**形态（结构 → `array(...)` / `shape(...)`，非有限数 →
 * `number()`）；确实不可表达（bigint / 函数 / 稀疏洞）⇒ null ⇒ 整条见证记
 * `no-serializable-cases` 不写盘。写出文本必须能被 `parseCaseArgExpr`
 * 往返（不再是 unknown、不再发 `nudo:directive-syntax`）。
 */
import { describe, it, expect } from "vitest";
import { type Abs, abs as makeAbs } from "@nudojs/core";
import { absLit } from "@nudojs/core/internal";
import {
  parse,
  extractDirectives,
  parseCaseArgExpr,
  type DirectiveDiag,
} from "@nudojs/parser";
import type { CaseDirective } from "@nudojs/parser";
import { serializeCaseArg, buildCaseDirective } from "../emit/case-emitter.ts";

function exact(shape: Abs["shape"]): Abs {
  return makeAbs(shape, undefined, undefined, "exact");
}
function sum(...members: Abs[]): Abs {
  return makeAbs({ k: "sum", members }, undefined, undefined, "path");
}
function tuple(elements: Abs[]): Abs {
  return exact({ k: "tuple", elements });
}
function obj(slots: Record<string, Abs>): Abs {
  const s: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) s[k] = { value: v };
  return exact({ k: "obj", slots: s });
}

/** 序列化文本必须能被指令文法吃回去：非 unknown 且零 nudo:directive-syntax。 */
function assertFrozenParses(text: string): void {
  const parsed = parseCaseArgExpr(text);
  expect(parsed.shape.k, text).not.toBe("unknown");
  const frozen = `/**
 * @nudo:case "call@symbolic" (${text})
 */
export function f(a) { return a; }`;
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(frozen), { diags });
  const c = fns[0]?.directives.find((d) => d.kind === "case") as CaseDirective | undefined;
  expect(c?.argsAbs[0]?.shape.k, text).not.toBe("unknown");
  expect(diags.filter((d) => d.code === "nudo:directive-syntax"), text).toEqual([]);
}

describe("Bug 29 — 折叠见证写出可往返的约束形态", () => {
  it("数组 / 对象成员 ⇒ union(array(...), shape(...))，不再写 union([2], {k:3})", () => {
    const text = serializeCaseArg(sum(tuple([absLit(2)]), obj({ k: absLit(3) })));
    expect(text).toBe("union(array(2), shape({ k: 3 }))");
    expect(text).not.toContain("[2]");
    assertFrozenParses(text!);
  });

  it("非有限数成员 ⇒ union(number(), -0)，不再写 union(Infinity, -0)", () => {
    const text = serializeCaseArg(sum(absLit(Infinity), absLit(-0)));
    expect(text).toBe("union(number(), -0)");
    expect(text).not.toContain("Infinity");
    assertFrozenParses(text!);
  });

  it("纯标量折叠保持 union(2, 3) 不变（既有钉不回归）", () => {
    expect(serializeCaseArg(sum(absLit(2), absLit(3)))).toBe("union(2, 3)");
    assertFrozenParses("union(2, 3)");
  });

  it("bigint 成员不可表达 ⇒ null（no-serializable-cases，不写非法文本）", () => {
    expect(serializeCaseArg(sum(absLit(1n), absLit(2n)))).toBeNull();
    expect(buildCaseDirective("call@symbolic", [sum(absLit(1n), absLit(2n))])).toBeNull();
  });

  it("buildCaseDirective 落出的指令同样能被解析（不退化 unknown）", () => {
    const directive = buildCaseDirective("call@symbolic", [
      sum(tuple([absLit(2)]), obj({ k: absLit(3) })),
    ]);
    expect(directive).toContain(`(union(array(2), shape({ k: 3 })))`);
    assertFrozenParses("union(array(2), shape({ k: 3 }))");
  });
});
