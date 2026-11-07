/**
 * Bug 876 — node env 的 `process` 成员表**缺 5 个真实成员**
 * （`emitWarning` / `abort` / `kill` / `release` / `features`）⇒ 正确代码拿到
 * 5 处 `nudo:entry-may-throw` 假红（成员读出 exact undefined ⇒ 调用 undefined
 * ⇒ 引擎**证明**「必抛 TypeError」）。
 *
 * 修法：packages/env/src/node.ts 的 `process` 表补这 5 个成员。
 * `features` 用**开放键 + boolean|string|undefined 值域**（键随构建而变；
 * 值域不用 unknown——否则 `process.features.icu` 退化成 unknown 并误报
 * nudo:unknown-inference）。
 *
 * 证据口径：原生 oracle（同进程真实 process）+ 引擎探针。
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
  return checkSource("/t/env-bug-876.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Bug 876 — process 补 5 个真实成员（不再定抛 TypeError）", () => {
  it("原生 oracle：五个成员在真实 Node 上都存在", () => {
    expect(typeof process.emitWarning).toBe("function");
    expect(typeof process.abort).toBe("function");
    expect(typeof process.kill).toBe("function");
    expect(typeof process.release).toBe("object");
    expect(typeof process.features).toBe("object");
    expect(typeof process.release.name).toBe("string");
  });

  it("env：process 面带 emitWarning / abort / kill / release / features", () => {
    for (const name of ["emitWarning", "abort", "kill"]) {
      expect(shapeOf(walk(env.globals.process, name), `process.${name}`)).toContain("=>");
    }
    expect(shapeOf(walk(env.globals.process, "release", "name"), "release.name")).toContain(
      "string",
    );
    expect(shapeOf(walk(env.globals.process, "features"), "process.features")).toBeTruthy();
  });

  it("引擎探针：五处 nudo:entry-may-throw 假红消失", () => {
    const src = `
      export function g1() { return process.emitWarning("x"); }
      export function g2() { return process.features.icu; }
      export function g3() { return process.release.name; }
      export function g4() { return process.kill(1, "SIGTERM"); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    const byName = new Map(r.signatures.map((s) => [s.name, s.display]));
    expect(byName.get("g3")).toMatch(/^string\b/);
    expect(byName.get("g4")).toMatch(/^boolean\b/);
  });
});
