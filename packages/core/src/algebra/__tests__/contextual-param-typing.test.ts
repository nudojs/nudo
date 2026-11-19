/**
 * 箭头 / 函数表达式的形参**上下文类型**（TS contextual typing）。
 *
 * `export const cb: Fn = (a, b) => …` 的形参自己没有注解，类型来自声明器
 * 注解（TS 语义：赋值目标的可调用类型逐位给出形参类型）。分析层此前只读
 * 形参自身的 `nudoTypeText` ⇒ 入口落 any ⇒ `a.toFixed(2)` 记 may-throw ⇒
 * `nudo:entry-may-throw` 对合法 TypeScript 假红。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { l2Count } from "./nudo-constraints.ts";

const ALIAS_CTX = `export type Fn = (a: number, b: number) => number;
export const cb: Fn = (a, b) => a + b;
`;

const INLINE_CTX = `export const withInline: (a: number) => string = (a) => String(a);
`;

const NO_CTX = `export const noAnn = (a) => String(a);
`;

const GENERIC_CTX = `export type Id<T> = (a: T) => T;
export const id: Id<number> = (a) => a;
`;

const SELF_ANN_WINS = `export type StrFn = (a: string) => string;
export const sa: StrFn = (a: number) => String(a);
`;

function sig(r: ReturnType<typeof checkSource>, name: string) {
  const found = r.signatures.find((s) => s.name === name);
  expect(found, `signature ${name} missing`).toBeDefined();
  return found!;
}

describe("箭头形参的上下文类型", () => {
  it("BUG-232 类型别名上下文逐位给出形参类型，入口不再报 may-throw", () => {
    const r = checkSource("/t/ctx-alias.ts", ALIAS_CTX, pTrue);

    expect(sig(r, "cb").paramTypes).toEqual(["number", "number"]);
    expect(sig(r, "cb").display).toBe("number");
    expect(l2Count(r, "cb")).toBe(0);
    expect(r.ok).toBe(true);
  });

  it("BUG-232 内联函数类型上下文同样生效", () => {
    const r = checkSource("/t/ctx-inline.ts", INLINE_CTX, pTrue);

    expect(sig(r, "withInline").paramTypes).toEqual(["number"]);
    expect(sig(r, "withInline").display).toBe("string");
    expect(l2Count(r, "withInline")).toBe(0);
  });

  it("BUG-232 负控制：无上下文类型时形参仍是 any（不凭空造类型）", () => {
    const r = checkSource("/t/ctx-none.ts", NO_CTX, pTrue);

    expect(sig(r, "noAnn").paramTypes).toEqual(["any"]);
    expect(l2Count(r, "noAnn")).toBe(1);
  });

  it("BUG-232 负控制：泛型别名的上下文要替换类型参数，不能直接采用（仍是 any）", () => {
    const r = checkSource("/t/ctx-generic.ts", GENERIC_CTX, pTrue);

    expect(sig(r, "id").paramTypes).toEqual(["any"]);
  });

  it("BUG-232 自注解优先于上下文类型", () => {
    const r = checkSource("/t/ctx-self.ts", SELF_ANN_WINS, pTrue);

    expect(sig(r, "sa").paramTypes).toEqual(["number"]);
  });
});
