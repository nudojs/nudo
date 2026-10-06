/**
 * issue #110（env 下 class extends Error 的 super(message) 槽不落地）：
 * #106 让 `class X extends Error` 定义期干净后，`super(message)` 仍是静默
 * no-op（constructClass 对无 spec 的内建基类原样返回 thisVal，args 丢弃），
 * `nudo check` 签名面 `e.message` / `e.name` 折假精确 `undefined #exact`
 * （原生为 message 字符串 / 原型链 "Error"）。
 *
 * 修复：constructClass 的 `!spec` 分支对 Error 家族按 errorBrandAbs 落
 * name/message 槽。tiering 与 `new Error(...)` 同口径：any message →
 * L2 may-throw（ToString Symbol 可能）+ message 槽 string 域；lit message
 * → 保精确。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { checkSource, pTrue, resetGeneralizeMemo, type RunTranspiledOptions } from "@nudojs/core";
import { collectEnvGlobals } from "../eval-run.ts";

const SRC = `/// @nudo:env es
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function msgErr(status, message) { const e = new ApiError(status, message); return e.message; }
export function nameErr(status, message) { const e = new ApiError(status, message); return e.name; }
export function msgLit() { const e = new ApiError(500, "boom"); return e.message; }
export function statusRead(status, message) { const e = new ApiError(status, message); return e.status; }
`;

let inject: RunTranspiledOptions;

beforeAll(() => {
  resetGeneralizeMemo();
  const envGlobals = collectEnvGlobals(["es"]);
  expect(Object.keys(envGlobals).length).toBeGreaterThan(0);
  inject = { envGlobals };
});

function check() {
  return checkSource("/t/env-super-error-slots.js", SRC, pTrue, { inject });
}

function sig(r: ReturnType<typeof check>, fn: string): string {
  return r.signatures.find((s) => s.name === fn)?.display ?? "(missing)";
}

function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

describe("#110 env class extends Error: super(message) 落 name/message 槽", () => {
  it("msgErr 签名：string 域（修复前 undefined #exact 假精确）", () => {
    const r = check();
    const d = sig(r, "msgErr");
    expect(d).toContain("string");
    expect(d).not.toContain("undefined");
  });

  it("nameErr 签名：\"Error\" 精确（原生经原型链）", () => {
    const r = check();
    expect(sig(r, "nameErr")).toContain('"Error"');
  });

  it("msgLit 签名：\"boom\" 精确；statusRead 子类槽不受影响", () => {
    const r = check();
    expect(sig(r, "msgLit")).toContain('"boom"');
    expect(sig(r, "statusRead")).not.toContain("undefined");
  });

  it("tiering 与 new Error 同口径：any message 构造 → L2 may-throw；lit → 干净", () => {
    const r = check();
    // nameErr 同样以 any message 构造（super(message) 的 ToString Symbol 可能，
    // 与 #106 的 mkErrAny 同口径）；返回值读 name 不消除构造期 may-throw
    expect(l2Count(r, "msgErr")).toBeGreaterThan(0);
    expect(l2Count(r, "nameErr")).toBeGreaterThan(0);
    expect(l2Count(r, "msgLit")).toBe(0);
  });
});
