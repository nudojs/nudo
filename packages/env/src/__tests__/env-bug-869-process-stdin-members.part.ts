/**
 * Bug 869 — env node：`process.stdin` 只建模 `{on}` ⇒ `process.stdin.setEncoding("utf8")`
 * 被判**定抛 TypeError**（假红；原生不抛）。
 *
 * 修法：process 的三个流（stdin / stdout / stderr）共用一张 Socket 面
 * （packages/env/src/node.ts 的 `processStreamBase`）——on/once/off/emit/
 * addListener/removeListener/pipe/destroy/setEncoding/pause/resume/read/
 * isTTY/fd/readable/writable；stdin 另加只读面，stdout/stderr 另加可写面。
 *
 * 证据口径：原生 oracle（同进程真实 process.stdin）+ 引擎探针。
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
  return checkSource("/t/env-bug-869.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Bug 869 — process.stdin 成员表补全（不再定抛 TypeError）", () => {
  it("原生 oracle：process.stdin 真的有 setEncoding / pause / resume / read", () => {
    expect(typeof process.stdin.setEncoding).toBe("function");
    expect(typeof process.stdin.pause).toBe("function");
    expect(typeof process.stdin.resume).toBe("function");
    expect(typeof process.stdin.read).toBe("function");
    expect(typeof process.stdin.on).toBe("function");
  });

  it("env：process.stdin 面带 setEncoding / pause / resume / read 等成员", () => {
    const stdin = walk(env.globals.process, "stdin");
    expect(stdin, "process.stdin 缺失").toBeTruthy();
    for (const name of ["on", "once", "off", "emit", "setEncoding", "pause", "resume", "read"]) {
      expect(shapeOf(walk(stdin, name), `stdin.${name}`)).toContain("=>");
    }
    expect(shapeOf(walk(stdin, "isTTY"), "stdin.isTTY")).toBeTruthy();
    expect(shapeOf(walk(stdin, "fd"), "stdin.fd")).toContain("number");
  });

  it("引擎探针：process.stdin.setEncoding(\"utf8\") 不再定抛 TypeError", () => {
    const src = `
      export function s1() { return process.stdin.setEncoding("utf8"); }
      export function s2() { return process.stdin.on("data", (c) => { void c; }); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const s of r.signatures) {
      expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();
    }
  });
});
