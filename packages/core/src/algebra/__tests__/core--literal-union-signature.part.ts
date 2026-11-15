/**
 * BUG-031 —— `nudo check` 签名面把「同 prim 的字面量 union」渲染成**基类型**
 * ⇒ 签名行（`v: number`）与本面自己的门槛诊断（`expected: (v = 1 ∨ v = 2 ∨
 * v = 3)`）互相矛盾，且与 dts 产物面（`v: 1 | 2 | 3`）结论相反。
 *
 * 根因：`format.ts` 的字面量提取只认**单个** `eq(term, lit(v))` 合取项；
 * `samePrimLiteralUnionAbs` 构造的是 `or(eq 1, eq 2, eq 3)` ⇒ 返回 undefined
 * ⇒ 退化成基类型。
 *
 * 本钉：签名面的参数类型必须与 dts 面同源（字面量集）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { stdOpts } from "./nudo-constraints.ts";

/** 同名侧车：源文件 file.js ⇒ 侧车 file.nudo.js */
function optsWithSidecar(sidecar: string) {
  return {
    loadModule: (spec: string): string | undefined =>
      spec === "./file.nudo.js" ? sidecar : stdOpts.loadModule(spec),
    fromFile: "/test/file.js",
  };
}

const SRC = `export function pick(v) {
  return v;
}
`;

const UNION_SIDE = `
import { fn, lit, union } from "@nudojs/core";
export const pick = fn({ v: union(lit(1), lit(2), lit(3)) });
`;

const NUM_SIDE = `
import { fn, number } from "@nudojs/core";
export const pick = fn({ v: number() });
`;

describe("BUG-031 — 同 prim 字面量 union 在签名面保留字面量集", () => {
  it("union(lit(1), lit(2), lit(3)) ⇒ `1 | 2 | 3`（不是 `number`）", () => {
    const r = checkSource("/test/file.js", SRC, pTrue, optsWithSidecar(UNION_SIDE));
    const sig = r.signatures.find((s) => s.name === "pick");
    expect(sig).toBeDefined();
    expect(sig!.paramTypes?.[0]).toBe("1 | 2 | 3");
    expect(sig!.paramTypes?.[0]).not.toBe("number");
  });

  it("负控制：裸 number 契约仍是 `number`", () => {
    const r = checkSource("/test/file.js", SRC, pTrue, optsWithSidecar(NUM_SIDE));
    const sig = r.signatures.find((s) => s.name === "pick");
    expect(sig!.paramTypes?.[0]).toBe("number");
  });
});
