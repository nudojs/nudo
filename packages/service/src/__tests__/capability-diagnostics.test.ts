/**
 * ABS-12 R12-D · `nudo:capability-denied` 诊断（strict 默认，trusted 可退出）。
 *
 * strict：已分类 denied 的宿主全局 / `node:` 模块从 `nudo:builtin-unknown`
 * 拆出，报告为 `nudo:capability-denied`（结果仍是 unknown，不执行宿主）。
 * trusted：保持旧面（全部走 builtin-unknown）。
 * 未分类名字（typo）在两档都是 builtin-unknown。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile } from "../analyzer.ts";
import { setCapabilityMode } from "@nudojs/core/internal";

let dir: string | undefined;

function freshFile(name: string): string {
  dir ??= mkdtempSync(join(tmpdir(), "nudo-cap-diag-"));
  return join(dir, name);
}

afterEach(() => {
  setCapabilityMode(undefined);
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

const codes = (r: ReturnType<typeof analyzeFile>): string[] =>
  r.diagnostics.map((d) => d.code ?? "");

describe("ABS-12 · capability-denied 诊断（strict 默认）", () => {
  it("denied 宿主全局（fetch / setTimeout / BroadcastChannel）走 capability-denied", () => {
    const src = `
export function f() {
  fetch("https://example.com");
  setTimeout(() => {}, 0);
  new BroadcastChannel("x");
}`;
    const r = analyzeFile(freshFile("globals.js"), src);
    const c = codes(r);
    expect(c.filter((x) => x === "nudo:capability-denied")).toHaveLength(3);
    expect(c).not.toContain("nudo:builtin-unknown");
  });

  it("denied node: 模块（node:fs）单独报 capability-denied；path 不误报", () => {
    const src = `
import fs from "node:fs";
import path from "node:path";
export function f() {
  return fs.readFileSync("/etc/hostname", "utf-8") + path.sep;
}`;
    const r = analyzeFile(freshFile("modules.js"), src);
    const denied = r.diagnostics.filter((d) => d.code === "nudo:capability-denied");
    expect(denied).toHaveLength(1);
    expect(denied[0]!.message).toContain("node:fs");
  });

  it("未分类名字（typo）仍是 builtin-unknown", () => {
    const src = `export function f() { return __nudo_typo_global__(); }`;
    const r = analyzeFile(freshFile("typo.js"), src);
    expect(codes(r)).toContain("nudo:builtin-unknown");
    expect(codes(r)).not.toContain("nudo:capability-denied");
  });
});

describe("ABS-12 · trusted 档退回旧面", () => {
  it("trusted：denied 全局回到 builtin-unknown，capability-denied 消失", () => {
    setCapabilityMode("trusted");
    const src = `
export function f() {
  fetch("https://example.com");
  setTimeout(() => {}, 0);
}`;
    const r = analyzeFile(freshFile("trusted.js"), src);
    const c = codes(r);
    expect(c).toContain("nudo:builtin-unknown");
    expect(c).not.toContain("nudo:capability-denied");
  });

  it("trusted：node:fs 不再报 capability-denied", () => {
    setCapabilityMode("trusted");
    const src = `
import fs from "node:fs";
export function f() { return fs.readFileSync("/x", "utf-8"); }`;
    const r = analyzeFile(freshFile("trusted-mod.js"), src);
    expect(codes(r)).not.toContain("nudo:capability-denied");
  });
});
