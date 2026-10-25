/**
 * body 编译执行的 strict 口径：ESM 源 → 编译单元发射 `"use strict"`（与
 * B run 模块体 strict 前缀同一判据 sourceHasEsmSyntax）；CJS/sloppy 源保持
 * sloppy。覆盖块级函数声明的 Annex B 分叉与 env 条目/闭包桥的透传。
 */
import { describe, it, expect } from "vitest";
import { $call } from "../exec/call.ts";
import { absFunction } from "../abs-fn.ts";
import { litValue } from "@nudojs/core";
import { parseSource } from "../parse-source.ts";
import { emptyEnv } from "../ast-env.ts";
import { extractFn } from "../generalize.ts";
import { applyCallbackAbs } from "../hof.ts";

function bodyOf(src: string, params = "", name = "f") {
  const file = parseSource(`function ${name}(${params}) { ${src} }`);
  const decl = (file.program.body as Array<{ type: string; params: Array<{ name?: string }>; body: never }>)[0]!;
  return decl.body;
}

const BLOCK_FN = "{ function g() { return 3; } } return g();";

function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("compiled body strict-mode parity (ESM vs CJS)", () => {
  it("ESM (strict) block function is not visible outside its block", () => {
    const f = absFunction([], { body: bodyOf(BLOCK_FN), strict: true });
    expect(caught(() => $call(f, []))).toBeInstanceOf(ReferenceError);
  });

  it("CJS (sloppy) block function hoists (Annex B) and is visible outside", () => {
    const f = absFunction([], { body: bodyOf(BLOCK_FN), strict: false });
    expect(litValue($call(f, []))).toEqual({ ok: true, value: 3 });
  });

  // 未声明赋值（strict ReferenceError / sloppy 建全局）在本引擎不可观测：
  // 转译侧赋值 lowering 会在写前读取该名（$assignRecord 的 prev 实参），
  // 未声明名在 strict/sloppy 下都会先抛 ReferenceError ⇒ 不作为 strict 回归。

  it("extractFn stamps source kind on env fns entries", () => {
    const esm = extractFn(`export function f() { return 1; }`, "f");
    expect(esm?.env.fns.get("f")?.strict).toBe(true);
    const cjs = extractFn(`function f() { return 1; }`, "f");
    expect(cjs?.env.fns.get("f")?.strict).toBe(false);
  });

  it("source kind flows from extractFn env into compiled body behavior", () => {
    const wrap = (src: string) => {
      const extracted = extractFn(src, "f")!;
      const entry = extracted.env.fns.get("f")!;
      return absFunction(entry.params, {
        body: entry.body,
        async: entry.async,
        env: extracted.env,
        strict: entry.strict,
      });
    };
    const esmFn = wrap(`export function f() { ${BLOCK_FN} }`);
    expect(caught(() => $call(esmFn, []))).toBeInstanceOf(ReferenceError);
    const cjsFn = wrap(`function f() { ${BLOCK_FN} }`);
    expect(litValue($call(cjsFn, []))).toEqual({ ok: true, value: 3 });
  });

  it("same-source closure wrappers inherit the strictness", () => {
    // 外层 ESM 严格函数调用同源闭包 helper：helper 的 body 也按 strict 编译
    const env = emptyEnv();
    env.fns.set("helper", { params: [], body: bodyOf(BLOCK_FN), async: false });
    const f = absFunction([], { body: bodyOf("return helper();"), env, strict: true });
    expect(caught(() => $call(f, []))).toBeInstanceOf(ReferenceError);
  });

  it("callback bridge propagates env entry strictness", () => {
    const env = emptyEnv();
    env.fns.set("f", { params: [], body: bodyOf(BLOCK_FN), async: false, strict: true });
    expect(
      caught(() =>
        applyCallbackAbs({ type: "Identifier", name: "f" } as { type: string }, [], env, undefined, undefined),
      ),
    ).toBeInstanceOf(ReferenceError);
  });
});
