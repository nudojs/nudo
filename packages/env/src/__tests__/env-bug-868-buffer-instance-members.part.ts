/**
 * Bug 868 — env node：`Buffer` 实例面**缺 `byteLength` / `buffer` / `byteOffset`**
 * ⇒ 成员读出 **exact `undefined`**（真值分别是 `4` / `ArrayBuffer` / `0`）。
 *
 * 修法：Buffer 实例形状（packages/env/src/node.ts 的 `BufferInstance`）补三个
 * 槽。`buffer` 用 ArrayBuffer 品牌（**不用 unknown**——unknown 会把签名污染
 * 成 unknown 并误报 nudo:unknown-inference）。
 *
 * 证据口径：原生 oracle（同进程真实 Buffer）+ 引擎探针（checkSource）。
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

/** Buffer 的实例面：envFn 的 returnType（静态面在 fn 的 slots 上） */
function bufferInstance(): Abs {
  const g = env.globals.Buffer!;
  expect(g, "global Buffer missing").toBeTruthy();
  expect(g.shape.k, "Buffer 形状").toBe("fn");
  return (g.shape as { returnType: Abs }).returnType;
}

function check(src: string) {
  return checkSource("/t/env-bug-868.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Bug 868 — Buffer 实例面补 byteLength / buffer / byteOffset", () => {
  it("原生 oracle：Buffer.alloc(4) 的三个成员是真值（不是 undefined）", () => {
    const b = Buffer.alloc(4);
    expect(b.byteLength).toBe(4);
    expect(b.byteOffset).toBe(0);
    expect(b.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("env：Buffer 实例形状带三个槽，且类型正确", () => {
    const inst = bufferInstance();
    expect(shapeOf(walk(inst, "byteLength"), "byteLength")).toContain("number");
    expect(shapeOf(walk(inst, "byteOffset"), "byteOffset")).toContain("number");
    expect(shapeOf(walk(inst, "buffer"), "buffer")).toContain("ArrayBuffer");
  });

  it("引擎探针：三个成员读出 number / ArrayBuffer / number（不再是 exact undefined）", () => {
    const src = `
      export function b1() { return Buffer.alloc(4).byteLength; }
      export function b2() { return Buffer.alloc(4).buffer; }
      export function b3() { return Buffer.alloc(4).byteOffset; }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    const byName = new Map(r.signatures.map((s) => [s.name, s.display]));
    expect(byName.get("b1")).toMatch(/^number\b/);
    expect(byName.get("b2")).toMatch(/^ArrayBuffer\b/);
    expect(byName.get("b3")).toMatch(/^number\b/);
  });
});
