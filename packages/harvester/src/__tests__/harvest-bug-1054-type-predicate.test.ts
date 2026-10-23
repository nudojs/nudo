/**
 * Bug 1054 回归（harvester 收割面）：harvester 把 **TS 类型谓词**的返回类型
 * （`x is T` / `asserts x is T`）收割成 **`unknown`** ⇒
 *   - 调用方的签名面变成 `unknown` ⇒ 触发 `nudo:unknown-inference`
 *     误导诊断（把「谓词返回 boolean」说成「推断失败」）；
 *   - dts 面写 `unknown` ⇒ 消费方 tsc TS2322 假红。
 *
 * 根因：`mapType` 的类型节点分派表**没有 `TypePredicate` 分支**
 * ⇒ 谓词落进兜底分支（`default: return absUnknown()`）。
 *
 * 真值（TS 语义，运行时）：
 *   - `x is T` ⇒ 返回 **`boolean`**（`T` 是**收窄信息**，是调用点的副作用，
 *     **不是**返回面）；
 *   - `asserts x is T` / `asserts x` ⇒ 返回 **`void`**（断言函数运行时返回
 *     `undefined`）⇒ 与 `: void` 返回同口径。
 *
 * 负控：普通返回类型（number / string / 联合 / 泛型 / void / unknown /
 * 对象 / 数组 / 字面量 / nullable）的收割结果**不变**。
 *
 * ⚠️ 草稿面（`dts-contract-draft.ts`，`nudo contract --from-dts`）不在本钉
 * 范围：谓词在草稿面落 `fn({...}, any())` + 备注「unmodeled type → any()」
 * （**如实标注**的降级，不是 `unknown` 误报）——见交付报告。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug1054-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** fn 的返回面 Abs（shape.returnType） */
function returnTypeOf(a: unknown): { shape: { k?: string; type?: string }; term?: unknown } {
  const shape = (a as { shape?: { k?: string; returnType?: unknown } }).shape;
  if (shape?.k !== "fn") throw new Error(`not a fn: ${shape?.k}`);
  return (shape.returnType as { shape: { k?: string; type?: string }; term?: unknown });
}

describe("Bug 1054 —— TS 类型谓词的返回类型（boolean / void，不是 unknown）", () => {
  it("`x is T` 的返回面是 boolean（不是 unknown，也不是被谓词的 T）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Foo { a: number }
export declare function isFoo(x: unknown): x is Foo;
`,
    );
    const env = harvestDts([p]);
    // 改前：`(unknown) => unknown`（谓词落兜底分支）
    expect(formatShape(env.globals["isFoo"]!)).toBe("(unknown) => boolean");
    const ret = returnTypeOf(env.globals["isFoo"]!);
    expect(ret.shape.k).toBe("prim");
    expect(ret.shape.type).toBe("boolean");
    // 被谓词的 `T`（Foo ⇒ brand）**不是**返回面
    expect(ret.shape.k).not.toBe("brand");
  });

  it("`asserts x is T` 的返回面与 `: void` 同口径（不是 unknown）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Foo { a: number }
export declare function assertFoo(x: unknown): asserts x is Foo;
export declare function plainVoid(x: unknown): void;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["assertFoo"]!)).toBe("(unknown) => undefined");
    // 与 `: void` 的返回面**逐字同构**（断言函数运行时返回 undefined）
    expect(returnTypeOf(env.globals["assertFoo"]!)).toEqual(
      returnTypeOf(env.globals["plainVoid"]!),
    );
  });

  it("`asserts x`（无 `is T`）也是 void 口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function assertPlain(x: unknown): asserts x;
export declare function plainVoid(x: unknown): void;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["assertPlain"]!)).toBe("(unknown) => undefined");
    expect(returnTypeOf(env.globals["assertPlain"]!)).toEqual(
      returnTypeOf(env.globals["plainVoid"]!),
    );
  });

  it("`this is T` / `asserts this is T` 同口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Foo { a: number }
export declare function isThis(x: unknown): this is Foo;
export declare function assertThis(x: unknown): asserts this is Foo;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["isThis"]!)).toBe("(unknown) => boolean");
    expect(formatShape(env.globals["assertThis"]!)).toBe("(unknown) => undefined");
  });

  it("谓词里的联合被谓词类型不影响返回面（仍是 boolean）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function isNumOrStr(x: unknown): x is number | string;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["isNumOrStr"]!)).toBe("(unknown) => boolean");
    expect(returnTypeOf(env.globals["isNumOrStr"]!).shape.type).toBe("boolean");
  });

  it("接口方法签名上的谓词同口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Foo { a: number }
export interface Guard {
  isFoo(x: unknown): x is Foo;
  assertFoo(x: unknown): asserts x is Foo;
}
export declare const guard: Guard;
`,
    );
    const env = harvestDts([p]);
    const slots = (
      env.globals["guard"]! as {
        shape: { shape: { shape: { slots: Record<string, { value: Abs }> } } };
      }
    ).shape.shape.shape.slots;
    expect(formatShape(slots["isFoo"]!.value)).toBe("(unknown) => boolean");
    expect(formatShape(slots["assertFoo"]!.value)).toBe("(unknown) => undefined");
  });

  it("函数类型（type literal）上的谓词同口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const fnType: (x: unknown) => x is string;
export declare const fnTypeAssert: (x: unknown) => asserts x is string;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["fnType"]!)).toBe("(unknown) => boolean");
    expect(formatShape(env.globals["fnTypeAssert"]!)).toBe("(unknown) => undefined");
  });

  it("负控：普通返回类型的收割结果不变", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare function retNum(): number;
export declare function retStr(): string;
export declare function retBool(): boolean;
export declare function retUnion(): number | string;
export declare function retGeneric<T>(x: T): T;
export declare function retVoid(): void;
export declare function retUndef(): undefined;
export declare function retUnknown(): unknown;
export declare function retObj(): { a: number };
export declare function retArr(): string[];
export declare function retLit(): "a" | "b";
export declare function retNullable(): string | null;
`,
    );
    const env = harvestDts([p]);
    expect(formatShape(env.globals["retNum"]!)).toBe("() => number");
    expect(formatShape(env.globals["retStr"]!)).toBe("() => string");
    expect(formatShape(env.globals["retBool"]!)).toBe("() => boolean");
    expect(formatShape(env.globals["retUnion"]!)).toBe("() => number | string");
    expect(formatShape(env.globals["retGeneric"]!)).toBe("(T) => T");
    expect(formatShape(env.globals["retVoid"]!)).toBe("() => undefined");
    expect(formatShape(env.globals["retUndef"]!)).toBe("() => undefined");
    expect(formatShape(env.globals["retUnknown"]!)).toBe("() => unknown");
    expect(formatShape(env.globals["retObj"]!)).toBe("() => { a: number }");
    expect(formatShape(env.globals["retArr"]!)).toBe("() => string[]");
    expect(formatShape(env.globals["retLit"]!)).toBe('() => "a" | "b"');
    expect(formatShape(env.globals["retNullable"]!)).toBe("() => string | null");
  });
});
