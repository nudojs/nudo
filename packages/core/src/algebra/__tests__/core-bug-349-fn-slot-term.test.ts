/**
 * Bug 349 —— check 签名面里 fn 形参的**内部占位 term** 不回显。
 *
 * 契约 fn（`fn({ x: number() }, number())`）的槽位 term 是 constraint.ts 生成的
 * 内部占位名（`x${i}` / `ret`），回显进签名面长成 TS 默认参数：
 * `f(cb: (number = x0) => number = ret) => number` —— 用户源码里根本没有这些名字。
 *
 * 关系 fn 槽位的 α 名（A1/B1…）**照旧回显**（hof-relation 的既有口径）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "@nudojs/core";
import { formatShape } from "../format.ts";
import { abs } from "../abs.ts";
import { v as termVar } from "../term.ts";

const SIDE = `import { fn, number } from "@nudojs/core";
export const f = fn({ cb: fn({ x: number() }, number()) }, number());
`;

const SRC = `export function f(cb) { return cb(1); }`;

describe("Bug 349 check 签名面：fn 形参不出现内部占位 term", () => {
  const r = checkSource("/t/b349.js", SRC, pTrue, {
    loadModule: (spec: string): string | undefined =>
      spec.includes("b349.nudo.js") ? SIDE : undefined,
    fromFile: "/t/b349.js",
  });
  const sig = r.signatures.find((s) => s.name === "f");

  it("形参类型是 (number) => number（无 x0 / ret）", () => {
    expect(sig).toBeDefined();
    expect(sig!.paramTypes[0]).toBe("(number) => number");
  });
  it("签名面不含占位名", () => {
    const line = r.signatures
      .map((s) => s.paramTypes.join(" | "))
      .join(" ");
    expect(line).not.toContain("x0");
    expect(line).not.toContain("ret");
  });
});

describe("Bug 349 formatShape：fn 内层槽位压占位 term、留 α 名", () => {
  it("占位 term（x0 / ret）不回显", () => {
    const slot = abs({ k: "prim", type: "number" }, termVar("x0"));
    const ret = abs({ k: "prim", type: "number" }, termVar("ret"));
    const f = abs(
      { k: "fn", params: ["x"], paramTypes: [slot], returnType: ret },
      undefined,
    );
    expect(formatShape(f)).toBe("(number) => number");
  });

  it("关系 fn 的 α 名（A1 / B1）照旧回显", () => {
    const slot = abs({ k: "any" }, termVar("A1"));
    const ret = abs({ k: "any" }, termVar("B1"));
    const f = abs(
      { k: "fn", params: ["x"], paramTypes: [slot], returnType: ret },
      undefined,
    );
    expect(formatShape(f)).toBe("(A1) => B1");
  });
});
