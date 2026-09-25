/**
 * 审查修复契约：
 * ① inject 管线——CheckOptions.inject 透传到 generalize / L2 / 记录通道
 * ② L2 类静态 / CJS 对象方法显式 throw 不得写死 throws:never
 * ③ freeIdentifiers 词法作用域（嵌套 params 不污染外层；ObjectMethod key 不计 free）
 * ④ callBudgetKey 对非 Abs 实参防御化
 */
import { describe, it, expect } from "vitest";
import {
  checkSource,
  generalizeFromAst,
  pTrue,
  formatAbs,
  absFunction,
  numLit,
  callBudgetKey,
  type RunTranspiledOptions,
} from "@nudojs/core";
import { freeIdentifiers } from "../exec/body-fn.ts";
import { parseSource } from "../parse-source.ts";
import type { Node } from "@babel/types";

function bodyOf(src: string, name: string): Node {
  const file = parseSource(src);
  const decl = (
    file.program.body as Array<{
      type: string;
      id?: { name: string };
      body: unknown;
    }>
  ).find((s) => s.type === "FunctionDeclaration" && s.id?.name === name)!;
  return decl.body as Node;
}

describe("check inject pipeline", () => {
  const mockSrc = `
/**
 * @nudo:mock double = (x) => x + x
 */
export function f(x) { return double(x); }
`;
  // mock 形状：Abs fn，恒等（f(x) → x，符号面保留 α）
  const mocks = {
    double: absFunction(["x"], { apply: (args) => args[0]! }),
  } as unknown as Record<string, never>;

  it("without inject: @nudo:mock source is fail-closed unknown", () => {
    const r = checkSource("/t/mock-off.js", mockSrc, pTrue, {});
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    // mock 门：无注入 → B 不可用 → 显式无信息
    expect(sig!.abs.shape.k).toBe("unknown");
  });

  it("with inject.mocks: generalize/check evaluate through B", () => {
    const inject: RunTranspiledOptions = { mocks: mocks as never };
    const r = checkSource("/t/mock-on.js", mockSrc, pTrue, { inject });
    const sig = r.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    // 不是 fail-closed unknown，也不是未绑定 mock 名的 ReferenceError→never
    expect(sig!.abs.shape.k).not.toBe("unknown");
    expect(sig!.abs.shape.k).not.toBe("never");
    expect(sig!.throws == null || sig!.throws === "").toBe(true);
    expect(formatAbs(sig!.abs)).not.toContain("unknown");
  });

  it("generalizeFromAst honors opts.inject (mock gate)", () => {
    const off = generalizeFromAst("f", mockSrc);
    expect(off!.symbolic.shape.k).toBe("unknown");
    const on = generalizeFromAst("f", mockSrc, { inject: { mocks: mocks as never } });
    expect(formatAbs(on!.symbolic)).not.toContain("unknown");
  });

  it("different inject identities do not share generalize memo", () => {
    const injectA: RunTranspiledOptions = { mocks: mocks as never };
    const injectB: RunTranspiledOptions = { mocks: {} };
    const a = generalizeFromAst("f", mockSrc, { inject: injectA });
    const b = generalizeFromAst("f", mockSrc, { inject: injectB });
    // A 有 mock → 可折叠；B 无 mock → fail-closed unknown（键不得串味）
    expect(formatAbs(a!.symbolic)).not.toContain("unknown");
    expect(b!.symbolic.shape.k).toBe("unknown");
  });
});

describe("L2 class / CJS method explicit throws", () => {
  it("class static method explicit throw is entry-may-throw", () => {
    const src = `export class Foo {
  static boom() { throw new TypeError("nope"); }
  static ok() { return 1; }
}
`;
    const r = checkSource("/t/cls-throws.js", src, pTrue, {});
    expect(
      r.issues.some((i) => i.code === "nudo:entry-may-throw" && i.fn === "Foo.boom"),
    ).toBe(true);
    // 静态方法正常返回的不误报
    expect(
      r.issues.some((i) => i.code === "nudo:entry-may-throw" && i.fn === "Foo.ok"),
    ).toBe(false);
  });

  it("CJS object method explicit throw is entry-may-throw", () => {
    const src = `module.exports = {
  boom() { throw new TypeError("nope"); },
  ok() { return 1; },
};
`;
    const r = checkSource("/t/cjs-throws.js", src, pTrue, {});
    expect(
      r.issues.some((i) => i.code === "nudo:entry-may-throw" && i.fn === "boom"),
    ).toBe(true);
    expect(
      r.issues.some((i) => i.code === "nudo:entry-may-throw" && i.fn === "ok"),
    ).toBe(false);
  });
});

describe("freeIdentifiers lexical scopes", () => {
  it("nested function params do not pollute outer free set", () => {
    const body = bodyOf("function f() { const g = (x) => x; return x; }", "f");
    const free = freeIdentifiers(body, []);
    expect(free.has("x")).toBe(true);
  });

  it("ObjectMethod non-computed key is not a free reference", () => {
    const body = bodyOf("function f() { return { valueOf() { return 1; } }; }", "f");
    const free = freeIdentifiers(body, []);
    expect(free.has("valueOf")).toBe(false);
  });

  it("outer free name is still detected after nested same-named param", () => {
    const body = bodyOf(
      "function f() { const g = (x) => x + 1; return x + 2; }",
      "f",
    );
    const free = freeIdentifiers(body, []);
    expect([...free]).toEqual(["x"]);
  });

  it("sibling const in same scope is not free", () => {
    const body = bodyOf("function f() { const k = 1; return k + 1; }", "f");
    const free = freeIdentifiers(body, []);
    expect(free.has("k")).toBe(false);
  });
});

describe("callBudgetKey defensiveness", () => {
  it("non-Abs args do not throw and stay distinguishable", () => {
    const jsFn = () => 1;
    const key = callBudgetKey("absfn", "id", [jsFn, numLit(1), null, undefined]);
    expect(key).toContain("js:function");
    expect(key).toContain("prim:1");
    expect(key).toContain("js:object"); // null
    expect(key).toContain("js:undefined");
  });

  it("Abs args keep shape:term fingerprint", () => {
    const key = callBudgetKey("absfn", "id", [numLit(3)]);
    expect(key).toBe("absfn|id|prim:3");
  });
});
