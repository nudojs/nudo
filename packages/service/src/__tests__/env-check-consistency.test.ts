/**
 * @nudo:env check/test 一致性：
 * check 符号面必须与 test 同口径注入命名 env（es/web/node），
 * 不得因文件声明 @nudo:env 就把不碰 env API 的函数一并打成 unknown。
 *
 * ① 注入 envGlobals → check 与 test 签名一致（home() => string）
 * ② 无注入 → 纯函数不受牵连（pureAdd 不是 unknown）
 * ③ 无注入 → env 函数 fail-closed unknown（只影响该面）
 * ④ 无 @nudo:env → 与 ② 相同（基线）
 */
import { describe, it, expect, beforeAll } from "vitest";
import { checkSource, pTrue, formatAbs, resetGeneralizeMemo } from "@nudojs/core";
import { collectEnvGlobals } from "../bpath-run.ts";
import { analyzeFileAsync } from "../analyzer.ts";
import type { RunTranspiledOptions } from "@nudojs/core";

const SRC = `/// @nudo:env node
export function home() { return process.cwd(); }
export function pureAdd(a, b) { return a + b; }
`;

const SRC_NO_ENV = `export function pureAdd(a, b) { return a + b; }
`;

beforeAll(() => {
  resetGeneralizeMemo();
});

describe("@nudo:env check/test consistency", () => {
  it("with envGlobals inject: check signatures match test (home => string)", async () => {
    const envGlobals = collectEnvGlobals(["node"]);
    expect(Object.keys(envGlobals).length).toBeGreaterThan(0);
    const inject: RunTranspiledOptions = { envGlobals };
    const r = checkSource("/t/env-check.js", SRC, pTrue, { inject });

    const home = r.signatures.find((s) => s.name === "home");
    expect(home).toBeDefined();
    expect(home!.abs.shape.k).toBe("prim");
    expect(formatAbs(home!.abs)).toContain("string");

    const pureAdd = r.signatures.find((s) => s.name === "pureAdd");
    expect(pureAdd).toBeDefined();
    expect(pureAdd!.abs.shape.k).not.toBe("unknown");
    expect(formatAbs(pureAdd!.abs)).not.toContain("unknown");
  });

  it("with envGlobals inject: test path agrees (home => string)", async () => {
    const result = await analyzeFileAsync("/t/env-check.js", SRC);
    const homeFn = result.functions.find((f) => f.name === "home");
    expect(homeFn).toBeDefined();
    const homeCase = homeFn!.cases.find(
      (c) => c.name.startsWith("entry@") || c.name.startsWith("call@"),
    );
    expect(homeCase).toBeDefined();
    expect(formatAbs(homeCase!.abs)).toContain("string");
  });

  it("without inject: pureAdd is NOT collateral-damaged to unknown", () => {
    resetGeneralizeMemo();
    const r = checkSource("/t/env-check-noinj.js", SRC, pTrue, {});
    const pureAdd = r.signatures.find((s) => s.name === "pureAdd");
    expect(pureAdd).toBeDefined();
    // 纯函数（无自由标识符）不受 @nudo:env 牵连
    expect(pureAdd!.abs.shape.k).not.toBe("unknown");
    expect(formatAbs(pureAdd!.abs)).not.toContain("unknown");
  });

  it("without inject: env-using home() is fail-closed unknown (only that face)", () => {
    resetGeneralizeMemo();
    const r = checkSource("/t/env-check-noinj2.js", SRC, pTrue, {});
    const home = r.signatures.find((s) => s.name === "home");
    expect(home).toBeDefined();
    // env 注入缺失 → 只有引用外部名的函数 fail-closed
    expect(home!.abs.shape.k).toBe("unknown");
  });

  it("no @nudo:env: baseline pureAdd is precise", () => {
    resetGeneralizeMemo();
    const r = checkSource("/t/env-base.js", SRC_NO_ENV, pTrue, {});
    const pureAdd = r.signatures.find((s) => s.name === "pureAdd");
    expect(pureAdd).toBeDefined();
    expect(pureAdd!.abs.shape.k).not.toBe("unknown");
    expect(formatAbs(pureAdd!.abs)).not.toContain("unknown");
  });
});
