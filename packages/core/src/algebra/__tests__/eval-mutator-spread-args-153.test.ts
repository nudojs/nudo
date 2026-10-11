/**
 * issue #153 回归：数组 mutator（push/unshift/splice…）的 spread 实参
 * `f.push(...xs)` 此前在两条转译路径被折成单参 `$unknown()`，污染容器元素域：
 * - stmt.ts ExpressionStatement mutator 快路径（语句位标识符/成员路径接收者）；
 * - emit.ts emitArrMutatorRebinds（表达式位 / 嵌套 mutator 的重绑行——重绑行
 *   以实参执行**真实变更**，$unknown() 污染在此发生）。
 * 修法：与普通调用（expr.ts $callNamed/$invoke，DEC-006 K5）同口径发射
 * `...$elems(<expr>)`——生成代码是数组字面量内的 JS spread，把 $elems
 * 返回的 Abs[] 平铺进 $arrMutContainer 的实参表。
 * $elems 元素域语义（exec/runtime/containers.ts）：
 * - tuple → 逐元素（保序逐位精确）；
 * - arr → 元素域单代表（与 $concat 同口径）；
 * - prim string → 逐 code point（与 node 原生 `push(..."ab")` 奇偶一致）。
 */
import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  formatAbs,
  abs,
} from "@nudojs/core";

/** 元素域已知的抽象 number[]（spread 单代表并入元素域用例） */
const arrNum = abs(
  { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "path") },
  undefined,
  undefined,
  "partial",
);

function callWith(
  src: string,
  args: unknown[],
  fnName = "f",
): { value: string; throws: string } {
  const run = runTranspiled(src, { mode: "analyze" });
  let result: { result?: unknown; throws?: unknown } = {};
  try {
    result = callTranspiledExportFull(run, fnName, args as never[]) as never;
  } catch {
    /* 入口整抛：值域经 throws 面表达 */
  }
  const norm = (a: unknown): string => formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return { value: norm(result.result), throws: norm(result.throws) };
}

describe("issue #153：mutator spread 实参不再折 $unknown()", () => {
  it("语句位：f.push(...g())（g 返回精确对象 tuple）→ 元素逐位精确", () => {
    // issue 原始形态：const findings=[]; findings.push(...check(x))
    const r = callWith(
      `export function f(x) {
        const check = () => [{ v: 1 }, { v: 2 }];
        const findings = [];
        findings.push(...check());
        return findings;
      }`,
      [42],
    );
    expect(r.value).not.toContain("unknown");
    expect(r.value).toContain("{ v: 1 }");
    expect(r.value).toContain("{ v: 2 }");
  });

  it("for-of scan 累积：out.push(...r.run(x))（常量对象数组的函数字段）→ 元素域精确", () => {
    const r = callWith(
      `export function f(x) {
        const rules = [{ run: () => [1, 2] }, { run: () => [3, 4] }];
        const out = [];
        for (const r of rules) {
          out.push(...r.run(x));
        }
        return out;
      }`,
      [42],
    );
    expect(r.value).not.toContain("unknown");
    // 两条规则的代表迭代 join：元素域收敛到数字字面量并集
    expect(r.value).toContain("1");
    expect(r.value).toContain("4");
  });

  it("混合实参顺序保持：out.push(2, ...xs, 3) → tuple 逐位", () => {
    const r = callWith(
      `export function f() {
        const xs = [10, 20];
        const out = [1];
        out.push(2, ...xs, 3);
        return out;
      }`,
      [],
    );
    expect(r.value).toBe("[1, 2, 10, 20, 3]");
  });

  it("spread 抽象 arr（元素域已知）→ 单代表并入元素域", () => {
    const r = callWith(
      `export function f(xs) {
        const out = [];
        out.push(...xs);
        return out;
      }`,
      [arrNum],
    );
    expect(r.value).not.toContain("unknown");
    expect(r.value).toContain("number");
  });

  it("表达式位（emitArrMutatorRebinds 重绑行）：const n = out.push(...g()) → 元素不丢", () => {
    const r = callWith(
      `export function f() {
        const g = () => [7, 8];
        const out = [];
        const n = out.push(...g());
        return [n, out];
      }`,
      [],
    );
    expect(r.value).not.toContain("unknown");
    expect(r.value).toContain("7");
    expect(r.value).toContain("8");
  });

  it("嵌套 mutator 实参（重绑路径）：out.push(...g(), other.pop()) → 元素不丢", () => {
    const r = callWith(
      `export function f() {
        const g = () => [7, 8];
        const other = [9];
        const out = [];
        const n = out.push(...g(), other.pop());
        return out;
      }`,
      [],
    );
    expect(r.value).not.toContain("unknown");
    expect(r.value).toContain("7");
    expect(r.value).toContain("8");
    expect(r.value).toContain("9");
  });

  it("原生奇偶对照：out.push(...\"ab\") → 逐 code point（与 node 语义一致）", () => {
    // node v26：[].push(..."ab") → ["a", "b"]（字符串按 code point 展开）；
    // $elems 对 prim string 的现有实现即逐 code point，如实钉住
    const r = callWith(
      `export function f() {
        const out = [];
        out.push(..."ab");
        return out;
      }`,
      [],
    );
    expect(r.value).toBe('["a", "b"]');
  });
});
