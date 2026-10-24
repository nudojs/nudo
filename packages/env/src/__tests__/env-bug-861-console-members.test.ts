/**
 * 族 29 · Bug 861 —— es env 的 `console` 成员表不完整 ⇒ 缺成员读出
 * **exact undefined** ⇒ `console.timeStamp()` 折「调用 undefined」=
 * **定抛 TypeError**，而原生**不抛** ⇒ L2 `nudo:entry-may-throw` **假红**。
 *
 * 根因：`packages/env/src/es.ts` 的 `consoleSlots` 是 18 个名字的**手写
 * 白名单**，缺 `timeStamp` / `dirxml` / `profile` / `profileEnd`
 * （node v26 实测存在）——闭对象缺槽读出 exact undefined（不是 unknown）。
 *
 * 断言双向：
 * - 正向：成员表**含** node v26 的公有 console 方法集；调用这些成员
 *   **不**产生 entry-may-throw；签名按原生拆（log 变参 / time 收 label? /
 *   assert 收 (condition, ...args)）。
 * - 反向：把成员表改回旧白名单 ⇒ 本文件必须失败（成员表断言 + 引擎
 *   诊断断言双侧都会红）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, resetGeneralizeMemo, formatShape, type Abs } from "@nudojs/core";
import { defineEnv } from "../es.ts";

/** es env 的全局表（≡ service 侧 `collectEnvGlobals(["es"])`）。 */
function esEnvGlobals(): Record<string, Abs> {
  return { ...defineEnv().globals };
}

type CheckResult = ReturnType<typeof checkSource>;

function checkWithEs(src: string): CheckResult {
  resetGeneralizeMemo();
  return checkSource("/t/env-bug-861.js", src, pTrue, {
    inject: { envGlobals: esEnvGlobals() },
  });
}

/** 取 console 对象的某个成员槽（env 声明面）。 */
function consoleMember(name: string): Abs | undefined {
  const consoleAbs = defineEnv().globals.console!;
  expect(consoleAbs.shape.k, "console must be an object").toBe("obj");
  const slots = (consoleAbs.shape as { slots?: Record<string, { value: Abs }> }).slots ?? {};
  return slots[name]?.value;
}

/** fn 形状的形参标签（envFn 写入 shape.params）。 */
function paramsOf(fn: Abs): string[] {
  expect(fn.shape.k).toBe("fn");
  return (fn.shape as { params: string[] }).params;
}

describe("Bug 861 · console 成员表补全（es env）", () => {
  it("1. 成员表含 node v26 的公有 console 方法集（旧白名单缺 4 个）", () => {
    // node v26 实测（Object.getOwnPropertyNames(console) 的公有方法面）
    const expected = [
      "log", "info", "debug", "warn", "error", "trace",
      "dir", "dirxml", "table",
      "group", "groupCollapsed", "groupEnd",
      "count", "countReset", "assert", "clear",
      "time", "timeLog", "timeEnd", "timeStamp",
      "profile", "profileEnd",
      "context", "createTask", "Console",
    ];
    for (const name of expected) {
      const fn = consoleMember(name);
      expect(fn, `console.${name} must be declared`).toBeTruthy();
      expect(fn!.shape.k, `console.${name} must be a function`).toBe("fn");
    }
  });

  it("2. 旧白名单缺的 4 个成员调用**不抛**（假红消除）", () => {
    for (const expr of [
      'console.timeStamp("m")',
      "console.dirxml({ a: 1 })",
      'console.profile("m")',
      'console.profileEnd("m")',
    ]) {
      const r = checkWithEs(`export function f() { ${expr}; }`);
      const mayThrow = r.issues.filter((i) => i.code === "nudo:entry-may-throw");
      expect(
        mayThrow.map((i) => i.message),
        `${expr} must not be reported as may-throw`,
      ).toEqual([]);
      // 签名不是 never（旧行为：调用 undefined ⇒ 定抛 TypeError ⇒ never）
      const sig = r.signatures.find((s) => s.name === "f");
      expect(sig, "f must have a signature").toBeTruthy();
      expect(formatShape(sig!.abs), `${expr} signature`).not.toMatch(/\bnever\b/);
    }
  });

  it("3. 签名按原生拆（旧实现全部复用同一个 voidFn ⇒ 形参面失真）", () => {
    // 输出族是变参
    expect(paramsOf(consoleMember("log")!)).toEqual(["...args"]);
    expect(paramsOf(consoleMember("error")!)).toEqual(["...args"]);
    // 计时族收 label?
    expect(paramsOf(consoleMember("time")!)).toEqual(["label?"]);
    expect(paramsOf(consoleMember("timeEnd")!)).toEqual(["label?"]);
    expect(paramsOf(consoleMember("timeStamp")!)).toEqual(["label?"]);
    // 断言族收 (condition, ...args)
    expect(paramsOf(consoleMember("assert")!)).toEqual(["condition", "...args"]);
    // 计数族收 label?
    expect(paramsOf(consoleMember("count")!)).toEqual(["label?"]);
    // 分组结束无参
    expect(paramsOf(consoleMember("groupEnd")!)).toEqual([]);
  });

  it("4. 既有成员面未回归（log/error/warn/info/assert 仍在且可调用）", () => {
    const r = checkWithEs(
      'export function f() { console.log("a", 1); console.error("e"); console.warn("w"); console.info("i"); console.assert(false, "m"); }',
    );
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const name of ["log", "error", "warn", "info", "assert"]) {
      expect(consoleMember(name), `console.${name}`).toBeTruthy();
    }
  });

  it("5. `new console.Console()` 不因缺槽被误判为定抛 TypeError", () => {
    const r = checkWithEs("export function f() { return new console.Console(); }");
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    const sig = r.signatures.find((s) => s.name === "f");
    expect(formatShape(sig!.abs)).toContain("Console");
  });
});
