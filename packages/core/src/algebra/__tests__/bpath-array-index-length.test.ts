/**
 * 数组巨大下标 / length 赋值边界（B 路径）。
 *
 * 原生语义：
 * - `a.length = n`：n 必须是非负整数且 ≤ 2^32-1（4294967295），否则 RangeError
 *   （负数、小数、NaN、Infinity、2^32 起全部 RangeError）。合法但巨大的 n
 *   使数组稀疏化——分析侧物化 n 个槽会 OOM（差分 corpus 中 a[4294967294]=1
 *   曾把 harness 打到 exit 137）。
 * - `a[i] = v`：0 ≤ i ≤ 2^32-2（4294967294）是数组下标（length 增长到 i+1，
 *   中间槽全是 hole）；i ≥ 2^32-1 是普通 expando 属性（length 不变，
 *   `i in a`/`a[i]`/Object.keys 都可见）。
 *
 * 修复口径：下标/length 超过物化上限（与 new Array(n) 的 4096 同源）时
 * 就地降级为 arr（元素 join、长度未知）——保持引用语义与 sound，不物化巨 tuple；
 * 非法 length 硬抛 RangeError；2^32-1 起下标按 expando 处理（降 arr 防假精确）。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, checkSource, pTrue } from "@nudojs/core";
import { withStdImport, stdOpts } from "./nudo-constraints.ts";

function call(src: string, fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, []);
}

function isNever(r: unknown): boolean {
  const a = r as { shape?: { k?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "never";
}

function throwsRangeError(t: unknown): boolean {
  const a = t as { shape?: { k?: string; name?: string } };
  return !!a && typeof a === "object" && a.shape?.k === "brand" && a.shape.name === "RangeError";
}

function isConcrete(v: unknown): boolean {
  return v !== undefined;
}

describe("B-path invalid array length assignment throws RangeError", () => {
  it.each(["-1", "1.5", "NaN", "Infinity", "4294967296", "Math.pow(2,32)"])(
    "a.length = %s throws (native RangeError)",
    (expr) => {
      const r = call(`export function f() { let a=[1,2,3]; a.length=${expr}; return 1; }`);
      expect(isNever(r.result)).toBe(true);
      expect(throwsRangeError(r.throws)).toBe(true);
    },
  );

  it("try/catch absorbs invalid length", () => {
    const r = call(
      `export function f() { let a=[1,2,3]; try { a.length=-1; } catch(e) { return 'caught'; } return 'missed'; }`,
    );
    expect(litValue(r.result)).toBe("caught");
  });

  it("valid small length keeps precise truncate/extend", () => {
    expect(litValue(call(`export function f() { let a=[1,2,3]; a.length=5; return a.length; }`).result)).toBe(5);
    expect(litValue(call(`export function f() { let a=[1,2,3]; a.length=5; return a[4]; }`).result)).toBe(undefined);
    expect(litValue(call(`export function f() { let a=[1,2,3]; a.length=5; return 3 in a; }`).result)).toBe(false);
    expect(litValue(call(`export function f() { let a=[1,2,3]; a.length=1; return a.length; }`).result)).toBe(1);
  });
});

describe("B-path huge array index/length assignment stays bounded", () => {
  it("index write beyond materialization cap degrades (no giant tuple)", () => {
    // 5000 > cap：原生 length 5001 但分析不物化——完成且不假精确
    const r = call(`export function f() { let a=[1,2,3]; a[5000]=1; return a.length; }`);
    expect(isNever(r.result)).toBe(false);
    expect(isConcrete(litValue(r.result))).toBe(false);
  });

  it("small index write stays precise", () => {
    expect(litValue(call(`export function f() { let a=[]; a[10]=7; return a[10]; }`).result)).toBe(7);
    expect(litValue(call(`export function f() { let a=[]; a[10]=7; return a.length; }`).result)).toBe(11);
    expect(litValue(call(`export function f() { let a=[]; a[10]=7; return 5 in a; }`).result)).toBe(false);
    expect(litValue(call(`export function f() { let a=[]; a[10]=7; return 10 in a; }`).result)).toBe(true);
  });

  it("length assignment beyond cap degrades (no giant tuple)", () => {
    const r = call(`export function f() { let a=[1,2,3]; a.length=5000; return a.length; }`);
    expect(isNever(r.result)).toBe(false);
    expect(isConcrete(litValue(r.result))).toBe(false);
  });

  it("length assignment at native max (2^32-1) stays bounded", () => {
    const r = call(`export function f() { let a=[1,2,3]; a.length=4294967295; return a.length; }`);
    expect(isNever(r.result)).toBe(false);
    expect(isConcrete(litValue(r.result))).toBe(false);
  });

  it("index write at native boundary (2^32-1) is expando, length unchanged but conservative", () => {
    const r = call(`export function f() { let a=[1,2,3]; a[4294967295]=1; return a.length; }`);
    expect(isNever(r.result)).toBe(false);
    // expando 写已降 arr：长度不得假精确折 3，也不得假精确折 4294967296
    expect(isConcrete(litValue(r.result))).toBe(false);
  });

  it("huge valid index write (2^32-2) completes without blowup", () => {
    const r = call(`export function f() { let a=[1,2,3]; a[4294967294]=1; return a.length; }`);
    expect(isNever(r.result)).toBe(false);
    expect(isConcrete(litValue(r.result))).toBe(false);
  });

  it("huge index reads on plain tuples stay exact undefined", () => {
    expect(litValue(call(`export function f() { let a=[1,2,3]; return a[4294967295]; }`).result)).toBe(undefined);
  });
});

describe("check signatures: length assignment", () => {
  function sigOf(src: string): string | undefined {
    const r = checkSource("/t/idx.js", withStdImport(src), pTrue, stdOpts);
    return r.signatures[0]?.display;
  }

  it("length truncation reaches the signature", () => {
    expect(sigOf(`export function f() { const a=[1,2,3]; a.length=1; return a.length; }`)).toBe("1  #exact");
  });

  it("length extension reaches the signature", () => {
    expect(sigOf(`export function f() { const a=[1,2,3]; a.length=5; return a.length; }`)).toBe("5  #exact");
  });

  it("invalid length throw is catchable in the signature", () => {
    expect(
      sigOf(
        `export function f() { const a=[1,2,3]; try { a.length=-1; return 'no'; } catch(e) { return e instanceof RangeError ? 'range' : 'other'; } }`,
      ),
    ).toBe("\"range\"  #exact");
  });

  it("huge valid length stays conservative in the signature", () => {
    expect(sigOf(`export function f() { const a=[1,2,3]; a.length=5000; return a.length; }`)).toBe("number  #path");
  });
});
