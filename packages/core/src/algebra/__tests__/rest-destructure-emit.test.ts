import { describe, it, expect } from "vitest";
import { transpile } from "../exec/transpile.ts";
import {
  $obj,
  $objRest,
  $get,
  $orDefault,
  formatAbs,
  runTranspiled,
  callTranspiledExportFull,
  litValue,
} from "@nudojs/core";
import { numLit } from "@nudojs/core";

describe("RestElement emit + rest runtime", () => {
  it("transpile emits $objRest / $arrRest", () => {
    const objSrc = `function f(o) { const { a, ...rest } = o; return rest; }`;
    const arrSrc = `function g(xs) { const [h, ...t] = xs; return t; }`;
    expect(transpile(objSrc)).toContain("$objRest");
    expect(transpile(arrSrc)).toContain("$arrRest");
  });

  it("$objRest drops named keys", () => {
    const o = $obj({ a: numLit(1), b: numLit(2) } as never);
    const rest = $objRest(o, ["a"]);
    const b = $get(rest, "b");
    expect(formatAbs(b)).toContain("2");
  });
});

// 嵌套 rest 模式（rest 实参为模式）：此前 emitDestructure 只认 Identifier，
// 模式实参静默丢绑定 → 子名自由读 spurious ReferenceError（差分 FALSE-THROW
// 金丝雀，钉过 knownFalseThrows）。rest 参绑定顺序（`_rest{i}` 后置 = TDZ）
// 与 rest 成员目标写回同批收口。
describe("nested rest pattern binding", () => {
  it("binds nested rest array pattern (...[b, c])", () => {
    const exports = runTranspiled(
      `export function f() { const [a, ...[b, c]] = [1, 2, 3]; return c; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("binds deeply nested rest (...[b, ...[c]])", () => {
    const exports = runTranspiled(
      `export function f() { const [a, ...[b, ...[c]]] = [1, 2, 3, 4]; return c; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("binds nested rest object pattern (...{0: b, 1: c})", () => {
    const exports = runTranspiled(
      `export function f() { const [a, ...{0: b, 1: c}] = [1, 2, 3]; return c; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
  });

  it("binds defaults inside nested rest pattern (...[b = 5])", () => {
    const exports = runTranspiled(
      `export function f() { const [a, ...[b = 5]] = [1]; return b; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 5 });
  });

  it("assignment-position nested rest binds member targets", () => {
    const exports = runTranspiled(
      `export function f() { const o = {}; [o.x, ...[o.y]] = [1, 2, 3]; return o.y; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("assignment-position object rest member target is written back", () => {
    const exports = runTranspiled(
      `export function f() { const o = {}; ({ a: o.x, ...o.r } = { a: 1, b: 2 }); return o.r.b; }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
  });

  it("rest param with array pattern (arrow) binds before destructure (no TDZ)", () => {
    const exports = runTranspiled(
      `export function f() { const g = (...[a, b]) => a + b; return g(4, 5); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 9 });
  });

  it("rest param with object pattern (function expression, args slot) binds", () => {
    const exports = runTranspiled(
      `export function f() { const g = function (...{0: a, 1: b}) { return a + b; }; return g(4, 5); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(litValue(r.result)).toEqual({ ok: true, value: 9 });
  });

  it("rest param pattern with own arguments slot binds (useArgsSlot path)", () => {
    // 发射序：`const _rest0` 必须先于引用它的解构行（后置 = TDZ ReferenceError）
    const out = transpile(
      `const g = function (...[a, b]) { return arguments.length + a + b; }; g(4, 5);`,
    );
    const declAt = out.indexOf("let _rest0 =");
    const useAt = out.indexOf("$idx(_rest0");
    expect(declAt).toBeGreaterThan(-1);
    expect(useAt).toBeGreaterThan(declAt);
    // 执行：绑定成立（修复前 result=never + ReferenceError）。值经
    // useArgsSlot 的 arguments 通道 widen——与普通 rest 参同口径的既有
    // 精度面，非本回归面。
    const exports = runTranspiled(
      `export function f() { const g = function (...[a, b]) { const n = arguments.length; return a + b; }; return g(4, 5); }`,
      { mode: "analyze" },
    );
    const r = callTranspiledExportFull(exports, "f", []);
    expect(r.result.shape.k).not.toBe("never");
  });
});
