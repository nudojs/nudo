/**
 * Bug 875 — node env 的 `process.hrtime` 被建模成**不可调用的对象** ⇒
 * `process.hrtime()` 退化成 `unknown` + **误导诊断** `nudo:unknown-inference`
 * （把责任指向用户代码）。
 *
 * 修法：`process.hrtime` 建成**可调用**的 envFn（返回 [seconds, nanos] 数组），
 * `bigint` 作为挂在它身上的静态槽（`opts.slots`）——原生
 * `process.hrtime.bigint()` 返回 bigint。
 *
 * 证据口径：原生 oracle（同进程真实 process.hrtime）+ 引擎探针。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, formatShape } from "@nudojs/core";
import type { Abs } from "@nudojs/core";
import { defineEnv } from "../node.ts";

const env = defineEnv();

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

function walk(a: Abs | undefined, ...keys: string[]): Abs | undefined {
  let cur: Abs | undefined = a;
  for (const k of keys) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") cur = cur.shape.shape as Abs | undefined;
    if (!cur || cur.shape.k !== "obj") return undefined;
    cur = cur.shape.slots[k]?.value;
  }
  return cur;
}

/** fn 形全局的**静态槽**面（envFn 的 `opts.slots`） */
function staticSlot(a: Abs | undefined, name: string): Abs | undefined {
  if (!a || a.shape.k !== "fn") return undefined;
  const slots = (a.shape as { slots?: Record<string, { value: Abs }> }).slots;
  return slots?.[name]?.value;
}

function check(src: string) {
  return checkSource("/t/env-bug-875.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Bug 875 — process.hrtime 是可调用的（不再 unknown + 误导诊断）", () => {
  it("原生 oracle：process.hrtime 是函数，返回 [seconds, nanos]；bigint() 返回 bigint", () => {
    expect(typeof process.hrtime).toBe("function");
    const t = process.hrtime();
    expect(Array.isArray(t)).toBe(true);
    expect(t.length).toBe(2);
    expect(typeof t[0]).toBe("number");
    expect(typeof t[1]).toBe("number");
    expect(typeof process.hrtime.bigint()).toBe("bigint");
  });

  it("env：hrtime 是 envFn（可调用）+ 静态槽 bigint", () => {
    const hrtime = walk(env.globals.process, "hrtime");
    expect(hrtime, "process.hrtime 缺失").toBeTruthy();
    expect(hrtime!.shape.k, "hrtime 形状").toBe("fn");
    expect(shapeOf(hrtime, "hrtime")).toContain("=>");
    expect(shapeOf(staticSlot(hrtime, "bigint"), "hrtime.bigint")).toContain("bigint");
  });

  it("引擎探针：process.hrtime() 推出 number[]，且无 unknown-inference 误导诊断", () => {
    const src = `
      export function useHrtime() { const t = process.hrtime(); return t; }
      export function useHrtimeBigint() { return process.hrtime.bigint(); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    const byName = new Map(r.signatures.map((s) => [s.name, s.display]));
    expect(byName.get("useHrtime")).toMatch(/^number\[\]/);
    expect(byName.get("useHrtimeBigint")).toMatch(/^bigint\b/);
  });
});
