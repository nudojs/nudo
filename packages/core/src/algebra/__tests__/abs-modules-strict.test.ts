/**
 * 模块导出桥（`collectAbsExports` → `fnToAbs`）的源种类严格性透传：
 * `AstEnv.fns` 条目的 `strict`（由源 AST 生产者按 ESM/CJS 面写入）必须原样
 * 进 `AbsFnImpl`，body 编译单元据此发射 `"use strict"`——块级函数声明在
 * ESM 下块外不可见（ReferenceError），CJS/sloppy 下按 Annex B 提升可见。
 *
 * 未记录 `strict`（合成 env / 老调用方）⇒ 不写 = sloppy（保守），不得按
 * 函数形态猜。
 */
import { describe, it, expect } from "vitest";
import { collectAbsExports } from "../abs-modules.ts";
import { emptyEnv } from "../ast-env.ts";
import { getFnImpl } from "../abs-fn.ts";
import { $call } from "../exec/call.ts";
import { parseSource } from "../parse-source.ts";
import { litValue } from "@nudojs/core";
import type { Abs } from "../abs.ts";

const BLOCK_FN = "{ function g() { return 3; } } return g();";

function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

/** ESM 导出函数 f，env 条目的 strict 按参数写入（undefined = 不记录） */
function exportedBlockFn(strict: boolean | undefined): Abs {
  const source = `export function f() { ${BLOCK_FN} }`;
  const file = parseSource(source);
  const decl = file.program.body[0] as unknown as { declaration: { body: never } };
  const env = emptyEnv();
  env.fns.set("f", {
    params: [],
    body: decl.declaration.body,
    async: false,
    ...(strict !== undefined ? { strict } : {}),
  });
  const f = collectAbsExports(file, env).named.f!;
  expect(f).toBeDefined();
  return f;
}

describe("module export bridge propagates source-kind strictness", () => {
  it("ESM env entry: exported fn keeps strict and block fn is not visible outside", () => {
    const f = exportedBlockFn(true);
    expect(getFnImpl(f)?.strict).toBe(true);
    expect(caught(() => $call(f, []))).toBeInstanceOf(ReferenceError);
  });

  it("CJS env entry: strict=false stays sloppy (Annex B hoists block fn)", () => {
    const f = exportedBlockFn(false);
    expect(getFnImpl(f)?.strict).toBe(false);
    expect(litValue($call(f, []))).toEqual({ ok: true, value: 3 });
  });

  it("unrecorded strict stays undefined (sloppy, conservative)", () => {
    const f = exportedBlockFn(undefined);
    // 「没有实现」与「有实现但没记录 strict」是两种状态：单看
    // `getFnImpl(f)?.strict` 时前者也 pass（可选链吞掉 undefined）——
    // 先钉实现存在，回归（桥丢 impl）才会红。
    const impl = getFnImpl(f);
    expect(impl).toBeDefined();
    expect(impl?.strict).toBeUndefined();
    expect(litValue($call(f, []))).toEqual({ ok: true, value: 3 });
  });
});
