/**
 * Bug 892 — env node 的 `process` 成员表**再缺 7 个真实成员**
 * （`umask` / `getActiveResourcesInfo` / `resourceUsage` / `availableMemory` /
 * `loadEnvFile` / `getBuiltinModule` / `constrainedMemory`）⇒ 正确代码拿到 7 处
 * `nudo:entry-may-throw` 假红。
 *
 * 修法：packages/env/src/node.ts 的 `process` 表补这 7 个成员。
 * `loadEnvFile` 只声明「不抛」的常规路径（原生对**不存在**的文件抛 ENOENT——
 * 那是错误路径的精度债，见交付报告；声明 may-throw 会把 L2 门禁假红引回来）。
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
  return checkSource("/t/env-bug-892.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Bug 892 — process 再补 7 个真实成员（不再定抛 TypeError）", () => {
  it("原生 oracle：七个成员在真实 Node 上都存在", () => {
    expect(typeof process.umask).toBe("function");
    expect(typeof process.getActiveResourcesInfo).toBe("function");
    expect(typeof process.resourceUsage).toBe("function");
    expect(typeof process.availableMemory).toBe("function");
    expect(typeof process.loadEnvFile).toBe("function");
    expect(typeof process.getBuiltinModule).toBe("function");
    expect(typeof process.constrainedMemory).toBe("function");
  });

  it("env：process 面带这 7 个成员", () => {
    for (const name of [
      "umask",
      "getActiveResourcesInfo",
      "resourceUsage",
      "availableMemory",
      "loadEnvFile",
      "getBuiltinModule",
      "constrainedMemory",
    ]) {
      expect(shapeOf(walk(env.globals.process, name), `process.${name}`)).toContain("=>");
    }
  });

  it("引擎探针：7 处 nudo:entry-may-throw 假红消失", () => {
    const src = `
      export function a() { return process.umask(0o022); }
      export function b() { return process.getActiveResourcesInfo(); }
      export function c() { return process.resourceUsage(); }
      export function d() { return process.availableMemory(); }
      export function e(p) { return process.loadEnvFile(p); }
      export function f(id) { return process.getBuiltinModule(id); }
      export function g() { return process.constrainedMemory(); }
    `;
    const r = check(src);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    const byName = new Map(r.signatures.map((s) => [s.name, s.display]));
    expect(byName.get("a")).toMatch(/^number\b/);
    expect(byName.get("b")).toMatch(/^string\[\]/);
    expect(byName.get("d")).toMatch(/^number\b/);
    expect(byName.get("g")).toMatch(/^number\b/);
  });
});
