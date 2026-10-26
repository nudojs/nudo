/**
 * body 编译执行的 strict 口径（原生 strict mode code 判据）：ESM 源**或**
 * 指令序言含 `"use strict"` → 编译单元发射 `"use strict"`；否则 sloppy。
 * 覆盖块级函数声明的 Annex B 分叉、env 条目/闭包桥的透传、函数体自身的
 * 指令序言，以及 class 方法恒 strict（与所在文件种类无关）。
 */
import { describe, it, expect } from "vitest";
import { $call } from "../exec/call.ts";
import { absFunction } from "../abs-fn.ts";
import { litValue } from "@nudojs/core";
import { parseSource } from "../parse-source.ts";
import { emptyEnv } from "../ast-env.ts";
import { extractFn } from "../generalize.ts";
import { applyCallbackAbs } from "../hof.ts";
import { sourceIsStrict, hasUseStrictDirective } from "../code-text.ts";

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

/** extractFn 的 env 条目 → Abs fn（透传条目 strictness/闭包 env） */
function compiledFrom(src: string, name = "f") {
  const extracted = extractFn(src, name)!;
  const entry = extracted.env.fns.get(name)!;
  return absFunction(entry.params, {
    body: entry.body,
    async: entry.async,
    env: extracted.env,
    strict: entry.strict,
  });
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
    const esmFn = compiledFrom(`export function f() { ${BLOCK_FN} }`);
    expect(caught(() => $call(esmFn, []))).toBeInstanceOf(ReferenceError);
    const cjsFn = compiledFrom(`function f() { ${BLOCK_FN} }`);
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

describe("directive prologue strictness (CJS script + \"use strict\")", () => {
  it("predicate: ESM syntax or Program directive prologue", () => {
    expect(sourceIsStrict(`export function f() {}`)).toBe(true);
    expect(sourceIsStrict(`function f() {}`)).toBe(false);
    expect(sourceIsStrict(`"use strict";\nfunction f() {}`)).toBe(true);
    expect(sourceIsStrict(`'use strict';\nfunction f() {}`)).toBe(true);
  });

  it("predicate ignores non-prologue / non-directive occurrences", () => {
    // 函数体内的指令不是 Program 序言（该函数体自行判定）
    expect(sourceIsStrict(`function f() { "use strict"; }`)).toBe(false);
    // 注释/普通字符串里的同形文本不是指令
    expect(sourceIsStrict(`// "use strict";\nfunction f() {}`)).toBe(false);
    expect(sourceIsStrict(`const s = "use strict";`)).toBe(false);
    // 带转义序列的字符串按规范不是 Use Strict Directive
    expect(sourceIsStrict(`"use\\x20strict";\nfunction f() {}`)).toBe(false);
    // AST 面守卫（sourceIsStrict 的文本粗筛之外的独立判定）
    expect(
      hasUseStrictDirective(parseSource(`"use\\x20strict";\nfoo();`).program),
    ).toBe(false);
    expect(hasUseStrictDirective(parseSource(`"use strict";\nfoo();`).program)).toBe(true);
  });

  it("extractFn stamps directive strictness on CJS entries", () => {
    const strictSrc = `"use strict";\nfunction f() { ${BLOCK_FN} }\nmodule.exports = { f };`;
    expect(extractFn(strictSrc, "f")?.env.fns.get("f")?.strict).toBe(true);
    const sloppySrc = `function f() { ${BLOCK_FN} }\nmodule.exports = { f };`;
    expect(extractFn(sloppySrc, "f")?.env.fns.get("f")?.strict).toBe(false);
  });

  it("function-body directive makes only that body strict", () => {
    const src = `function f() { "use strict"; ${BLOCK_FN} }
function h() { ${BLOCK_FN} }
module.exports = { f, h };`;
    expect(extractFn(src, "f")?.env.fns.get("f")?.strict).toBe(true);
    expect(extractFn(src, "h")?.env.fns.get("h")?.strict).toBe(false);
  });

  it("strictness inherits lexically into nested functions", () => {
    const src = `function host() {
  "use strict";
  function inner() { ${BLOCK_FN} }
  return inner();
}
function h() { ${BLOCK_FN} }
module.exports = { host, h };`;
    expect(extractFn(src, "inner")?.env.fns.get("inner")?.strict).toBe(true);
    expect(caught(() => $call(compiledFrom(src, "inner"), []))).toBeInstanceOf(ReferenceError);
    // 兄弟函数不在严格区内 ⇒ 保持 sloppy
    expect(extractFn(src, "h")?.env.fns.get("h")?.strict).toBe(false);
  });

  it("CJS with directive: compiled body may throw ReferenceError (native parity)", () => {
    const strictFn = compiledFrom(`"use strict";\nfunction f() { ${BLOCK_FN} }`);
    expect(caught(() => $call(strictFn, []))).toBeInstanceOf(ReferenceError);
    const sloppyFn = compiledFrom(`function f() { ${BLOCK_FN} }`);
    expect(litValue($call(sloppyFn, []))).toEqual({ ok: true, value: 3 });
  });

  it("sloppy file + strict function body: only the directive body is strict", () => {
    const src = `function f() { "use strict"; ${BLOCK_FN} }`;
    expect(caught(() => $call(compiledFrom(src), []))).toBeInstanceOf(ReferenceError);
  });
});

describe("class methods are always strict (native: class body is strict code)", () => {
  it("CJS class method entry is strict; block-level fn does not Annex-B hoist", () => {
    const src = `class C { m() { ${BLOCK_FN} } }
module.exports = { C };`;
    const extracted = extractFn(src, "C.m")!;
    expect(extracted.env.fns.get("C.m")?.strict).toBe(true);
    expect(caught(() => $call(compiledFrom(src, "C.m"), []))).toBeInstanceOf(ReferenceError);
  });

  it("ESM class method stays strict", () => {
    const src = `export class C { m() { ${BLOCK_FN} } }`;
    expect(extractFn(src, "C.m")?.env.fns.get("C.m")?.strict).toBe(true);
    expect(caught(() => $call(compiledFrom(src, "C.m"), []))).toBeInstanceOf(ReferenceError);
  });

  it("nested class methods (directive-scope registrar) are strict too", () => {
    const src = `function wrap() {
  class Inner { run() { ${BLOCK_FN} } }
  return Inner;
}
module.exports = { wrap };`;
    expect(extractFn(src, "Inner.run")?.env.fns.get("Inner.run")?.strict).toBe(true);
  });

  it("functions nested in a class body inherit strictness", () => {
    const src = `class C { m() { function inner() { ${BLOCK_FN} } return inner(); } }
module.exports = { C };`;
    expect(extractFn(src, "inner")?.env.fns.get("inner")?.strict).toBe(true);
    expect(caught(() => $call(compiledFrom(src, "inner"), []))).toBeInstanceOf(ReferenceError);
  });

  it("class field initializer functions inherit strictness (class body is strict code)", () => {
    const src = `class C { m = () => { ${BLOCK_FN} }; }
module.exports = { C };`;
    expect(extractFn(src, "C.m")?.env.fns.get("C.m")?.strict).toBe(true);
    expect(caught(() => $call(compiledFrom(src, "C.m"), []))).toBeInstanceOf(ReferenceError);
  });
});
