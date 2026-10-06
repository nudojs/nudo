/**
 * issue #106 回归：env 声明构造器的 constructibility 假 may-throw。
 *
 * 现象（1.3.5 起）：`nudo.env` 开启时 `new Error(msg)` / `new TypeError(msg)` /
 * `class X extends Error` 报 "new on function value of unknown constructibility" /
 * "class extends fn function value (may not be a constructor)"——与实参无关，
 * 纯构造性误报（`new Error()` 无参同样命中）。无 env 时同代码干净。
 *
 * 根因：env 的 Error 族声明为无名 envFn——$new 的按名派发
 * （evalBuiltinNew → errorBrandAbs）拿不到名字，落到通用 fn 分支的
 * constructibility 门；$class 的 extends 门同样只见 ctor:undefined。
 *
 * 修复：envFn 支持 ctor 标记；Error 族 / URL / AbortController /
 * EventEmitter / stream 族声明 name + ctor:true（Symbol 声明 ctor:false——
 * 原生非构造器）。$new 的 ctor:true-无-impl 路径回落声明 returnType
 * （保实例面精度）。
 *
 * 边界（有意保留，原生如实）：`new Error(anyMsg)` 仍报 may-throw——
 * node 实测 `new Error(Symbol())` 抛 TypeError（message 过 ToString），
 * 与无 env 宿主路径（errorBrandAbs message tiering）同口径；对照
 * `new Error('lit')` / `new TypeError('lit')` 干净。
 */
import { describe, it, expect, beforeAll } from "vitest";
import { checkSource, pTrue, resetGeneralizeMemo, type RunTranspiledOptions } from "@nudojs/core";
import { collectEnvGlobals } from "../eval-run.ts";

const SRC = `/// @nudo:env es, web
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function badRequest(code, message) { return new ApiError(400, code, message); }
export function mkErrLit() { return new Error('boom'); }
export function newTypedLit() { return new TypeError('bad type'); }
export function mkErrAny(s) { return new Error(s); }
export function callNoNew(s) { return Error(s); }
export function newDate() { return new Date(); }
export function newAC() { return new AbortController(); }
`;

let inject: RunTranspiledOptions;

beforeAll(() => {
  resetGeneralizeMemo();
  const envGlobals = collectEnvGlobals(["es", "web"]);
  expect(Object.keys(envGlobals).length).toBeGreaterThan(0);
  inject = { envGlobals };
});

function check() {
  return checkSource("/t/env-ctor-may-throw.js", SRC, pTrue, { inject });
}

function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter((i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn)).length;
}

describe("#106 env 声明构造器不报 constructibility 假 may-throw", () => {
  it("class extends Error + super(message) + new ApiError：零 constructibility L2（定义期与构造期都合法）", () => {
    const r = check();
    // #110 起 super(message) 落地 name/message 槽：any message 构造记录
    // message-ToString may-throw（与 new Error(anyMsg) 同口径，原生如实）。
    // 本用例只守 #106 的 constructibility 假阳性为零——其余 cause 不应出现。
    const causes = r.issues
      .filter((i) => i.code === "nudo:entry-may-throw" && i.fn === "badRequest")
      .map((i) => i.suggestion?.split("→")[0] ?? "");
    expect(causes.length).toBeGreaterThan(0);
    expect(causes.every((c) => c.includes("message ToString"))).toBe(true);
  });

  it("new Error('lit') / new TypeError('lit')：零 L2，签名保 Error/TypeError brand", () => {
    const r = check();
    expect(l2Count(r, "mkErrLit")).toBe(0);
    expect(l2Count(r, "newTypedLit")).toBe(0);
    const sig = r.signatures.find((s) => s.name === "mkErrLit")?.display ?? "(missing)";
    expect(sig).toContain("Error");
  });

  it("new AbortController()：零 L2（ctor:true + 声明 returnType 回落）", () => {
    const r = check();
    expect(l2Count(r, "newAC")).toBe(0);
  });

  it("对照不受影响：newDate / callNoNew 零 L2", () => {
    const r = check();
    expect(l2Count(r, "newDate")).toBe(0);
    expect(l2Count(r, "callNoNew")).toBe(0);
  });

  it("边界（原生如实）：new Error(anyMsg) 仍报 may-throw（message ToString，Symbol 可能）", () => {
    const r = check();
    expect(l2Count(r, "mkErrAny")).toBeGreaterThan(0);
  });
});
