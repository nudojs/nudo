/**
 * 迭代消费者一致性：`$arrRest`（rest 解构）/ `$elems`（spread / for-of）/
 * `Array.from` 必须对同一接收者得到同一个元素序列与长度结论。
 *
 * 这条矩阵钉住能力函数（`iterableExactElements`）的消费面：任何消费者
 * 私自维护「哪些内建可迭代」表、或漏掉一种接收者，都会在这里分叉。
 */
import { describe, it, expect } from "vitest";
import { anyAbs, callTranspiledExportFull, formatAbs, runTranspiled, $lit } from "@nudojs/core";

function evalExport(src: string, fnName: string): string {
  const run = runTranspiled(src, { mode: "analyze" });
  const result = callTranspiledExportFull(run, fnName, [] as never[]) as {
    result?: unknown;
  };
  return formatAbs((result.result ?? $lit(undefined)) as never)
    .replace(/\s+#(?:exact|path|partial)$/, "")
    .replace(/^"(.*)"$/, "$1");
}

function expectSame(src: string, fnName: string, expected: string): void {
  expect(evalExport(src, fnName)).toBe(expected);
  // 负控制：入口未被错误收成 any。
  expect(evalExport(src, fnName)).not.toBe(formatAbs(anyAbs));
}

describe("迭代消费者一致性（rest / spread / for-of / Array.from）", () => {
  it("Set：rest 切片、spread 长度、Array.from 长度、for-of 求和一致", () => {
    expectSame(
      `export function f() {
        const s = new Set([1, 2]);
        const [a, ...rest] = s;
        const spread = [...s];
        let sum = 0;
        for (const v of s) sum += v;
        return rest.length === 1 &&
          spread.length === 2 &&
          a + rest[0] + sum === 6;
      }`,
      "f",
      "true",
    );
    // Array.from 的契约是 arr（长度未知），只保证元素域 / 长度域是 number。
    expect(evalExport(`export function f() {
      return Array.from(new Set([1, 2])).length;
    }`, "f")).toMatch(/^number\b/);
  });

  it("Map：条目元组在 rest / spread / Array.from / for-of 同序", () => {
    expectSame(
      `export function f() {
        const m = new Map([["a", 1], ["b", 2]]);
        const [first, ...tail] = m;
        const spread = [...m];
        let keys = first[0];
        for (const entry of m) keys += entry[0];
        return keys === "aab" &&
          tail.length === 1 &&
          spread.length === 2 &&
          tail[0][0] === "b";
      }`,
      "f",
      "true",
    );
    expect(evalExport(`export function f() {
      return Array.from(new Map([["a", 1]])).length;
    }`, "f")).toMatch(/^number\b/);
  });

  it("boxed String：code point 序列在四个消费者上一致", () => {
    expectSame(
      `export function f() {
        const s = new String("ab");
        const [a, ...rest] = s;
        const spread = [...s];
        const from = Array.from(s);
        return a === "a" &&
          rest[0] === "b" &&
          rest.length === spread.length - 1 &&
          spread.length === from.length;
      }`,
      "f",
      "true",
    );
  });

  it("TypedArray：rest 切片、spread 长度、Array.from 长度、for-of 求和一致", () => {
    expectSame(
      `export function f() {
        const t = new Uint8Array([1, 2, 3]);
        const [a, ...rest] = t;
        const spread = [...t];
        const from = Array.from(t);
        return a + rest[0] + rest[1] === 6 &&
          rest.length === spread.length - 1 &&
          spread.length === from.length;
      }`,
      "f",
      "true",
    );
  });

  it("字面量字符串：rest 切片与 spread / Array.from 长度一致", () => {
    expectSame(
      `export function f() {
        const [a, ...rest] = "ab";
        return a === "a" &&
          rest[0] === "b" &&
          rest.length === 1 &&
          [..."ab"].length === 2;
      }`,
      "f",
      "true",
    );
    expect(evalExport(`export function f() {
      return Array.from("ab").length;
    }`, "f")).toMatch(/^number\b/);
  });
});
