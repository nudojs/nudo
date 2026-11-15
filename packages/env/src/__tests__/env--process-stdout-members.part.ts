/**
 * Bug 871 — node env 的 `process.stdout` / `process.stderr` 面**只有 `write`**
 * ⇒ `.on(...)` 必抛 TypeError ⇒ L2 门禁假红。
 *
 * 修法：stdout / stderr 与 stdin 共用 Socket 面（packages/env/src/node.ts 的
 * `processStreamBase`），另加可写面（write / end / cork / uncork）。
 *
 * 证据口径：原生 oracle（同进程真实 process.stdout/stderr）+ 引擎探针。
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

function check(src: string) {
  return checkSource("/t/env-bug-871.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Bug 871 — process.stdout / stderr 成员表补全（不再定抛 TypeError）", () => {
  it("原生 oracle：stdout / stderr 真的有 on / once / off / emit / write", () => {
    for (const s of [process.stdout, process.stderr]) {
      expect(typeof s.on).toBe("function");
      expect(typeof s.once).toBe("function");
      expect(typeof s.off).toBe("function");
      expect(typeof s.emit).toBe("function");
      expect(typeof s.write).toBe("function");
    }
  });

  it("env：stdout / stderr 面带 on / once / off / emit / write / end 等成员", () => {
    for (const name of ["stdout", "stderr"]) {
      const stream = walk(env.globals.process, name);
      expect(stream, `process.${name} 缺失`).toBeTruthy();
      for (const m of ["on", "once", "off", "emit", "write", "end", "destroy", "cork", "uncork"]) {
        expect(shapeOf(walk(stream, m), `${name}.${m}`)).toContain("=>");
      }
    }
  });

  it("引擎探针：process.stdout.on(...) 不再定抛 TypeError", () => {
    const src = `
      export function o1() { return process.stdout.on("data", (c) => { void c; }); }
      export function o2() { return process.stderr.on("error", (c) => { void c; }); }
      export function o3() { return process.stdout.write("x"); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const s of r.signatures) {
      expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();
    }
  });
});
