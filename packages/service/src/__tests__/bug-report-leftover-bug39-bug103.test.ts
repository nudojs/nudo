/**
 * Bug 39 / Bug 103 残留回归（根因同在
 * `analyzer-orchestrate-uncached-cases.ts` 的 `evaluateEntryCase` 入口兜底）。
 *
 * - Bug 39：无调用点的**类实例方法**普查名是点号名（`C.total`），入口兜底
 *   无条件用 `tryEvalCallFull(source, filePath, "C.total", …)` 按模块导出名取
 *   值必落空 ⇒ `combinedAbs` 回落 `{ shape: unknown }` ⇒ dts / guard / zod /
 *   standard 四面全线 unknown。修法：`if (!entryAbs)` 之前补类方法派发兜底
 *   （`evalClassMethodWitness` + `isDottedName`）。
 * - Bug 103：rest 形参入口实参原来是一个「值为 arr(any) 的位置实参」，
 *   `$restBind` 把它收成 `[arr(any)]` 一元组 ⇒ `identity` 返回 `[any[]]`、
 *   `first` 返回 `any[]`、`count` 折字面量 1。修法：`restEntryArgAbs()` 改返回
 *   `makeSymbolicRestAbs()` 符号 rest 哨兵（`$restBind` 直通开放数组）。
 *
 * 两钉都直接读 `analyzeFile` 的 `combinedAbs`（产物面的唯一取型源），
 * 与 `nudo check` 面同源。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

function combinedOf(filePath: string, name: string) {
  const result = analyzeFile(filePath, readFileSync(filePath, "utf-8"));
  return result.functions.find((f) => f.name === name)?.combinedAbs;
}

describe("Bug 39 — 无调用点的类实例方法入口兜底不再回落 unknown", () => {
  const CART = `export class Cart {
  total() { return 0; }
  add(n: number) { return n + 1; }
}
export class Used {
  twice() { return 2; }
}
export function useIt() { return new Used().twice(); }
`;

  it("Cart.total / Cart.add 的 combinedAbs 是 number（不是 unknown）", () =>
    withTmpProject("nudo-b39-", (dir) => {
      const file = writeTmpFile(dir, "cart.ts", CART);
      for (const name of ["Cart.total", "Cart.add"]) {
        const c = combinedOf(file, name);
        expect(c, name).toBeDefined();
        expect(c!.shape.k, name).not.toBe("unknown");
        // 值面：total 折精确 0、add 是 number prim（与 check 面同源）
        expect(c!.shape.k, name).toBe("prim");
        expect((c!.shape as { type?: string }).type, name).toBe("number");
      }
    }));

  it("已被调用过的 Used.twice 仍正常（对照组不回归）", () =>
    withTmpProject("nudo-b39-ctl-", (dir) => {
      const file = writeTmpFile(dir, "cart.ts", CART);
      const c = combinedOf(file, "Used.twice");
      expect(c).toBeDefined();
      expect(c!.shape.k).not.toBe("unknown");
    }));
});

describe("Bug 103 — rest 形参入口兜底恢复开放数组（不再多一层元组）", () => {
  const REST = `export function identity(...xs) { return xs; }
export function first(...xs) { return xs[0]; }
export function count(...xs) { return xs.length; }
`;

  it("identity 是 arr（非 tuple）、first 是 any、count 是 number（非字面量 1）", () =>
    withTmpProject("nudo-b103-", (dir) => {
      const file = writeTmpFile(dir, "r.js", REST);
      const identity = combinedOf(file, "identity");
      expect(identity).toBeDefined();
      expect(identity!.shape.k).toBe("arr"); // 改前是 tuple `[any[]]`
      expect(identity!.shape.k).not.toBe("tuple");

      const first = combinedOf(file, "first");
      expect(first).toBeDefined();
      expect(first!.shape.k).toBe("any"); // 改前是 arr `any[]`

      const count = combinedOf(file, "count");
      expect(count).toBeDefined();
      expect(count!.shape.k).toBe("prim");
      expect((count!.shape as { type?: string }).type).toBe("number");
      // 改前 `xs.length` 折字面量 1（term.op === "lit"）
      if (count!.term?.op === "lit") {
        expect(count!.term.value).not.toBe(1);
      }
    }));

  it("非 rest 形参的入口兜底口径不变（对照组）", () =>
    withTmpProject("nudo-b103-ctl-", (dir) => {
      const file = writeTmpFile(dir, "p.js", `export function len(a) { return a.length; }\n`);
      const c = combinedOf(file, "len");
      expect(c).toBeDefined();
      expect(c!.shape.k).not.toBe("tuple");
    }));
});
