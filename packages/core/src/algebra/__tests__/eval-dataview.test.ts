/**
 * Bug 35 回归：DataView 存取族（get/set 全家）与构造器越界——
 * out-of-bounds 访问必须定抛 RangeError（node oracle 钉全矩阵），
 * 抽象 offset/视图 → may RangeError（L2 gate），合法构造/边界读不回退。
 *
 * 此前 evalBuiltinInstanceMethod 无 DataView 条目（调用折 unknown、
 * catch 臂死代码）、makeDataViewAbs 只做 ToIndex 不做 bounds
 * （new DataView(buf, 4, 8) / (buf, 9) 原生 RangeError 引擎 no-throw）。
 *
 * 原生 ground truth（node v26 实测）：
 * - get/set 全族：offset + 元素宽 > 视图 byteLength → RangeError
 *   （子视图按视图长度：new DataView(buf8, 4, 2).getUint8(2) 抛）；
 * - 方法 byteOffset 过 ToIndex：负 → RangeError；缺省/undefined → 0；
 * - ctor：byteOffset > buffer.byteLength 或 off+len > bufLen → RangeError；
 * - byteLength 实参 undefined ≡ 缺省（填满缓冲区——先判 undefined 再
 *   ToIndex：new DataView(buf8, 2, undefined).byteLength === 6；null 仍
 *   ToIndex → 0）；
 * - 读返回域：number 家族 → number、BigInt64/BigUint64 → bigint；
 *   写恒 undefined（元素值域未建模的诚实 imprecision）。
 */
import { describe, it, expect } from "vitest";
// 相对路径引 src 引擎面（不经 @nudojs/core 别名——本 worktree 的 vite8
// 别名解析会把裸包名落到 dist 旧产物，同 eval-ta-hofs.test.ts）。
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { checkSource } from "../check.ts";
import { litValue, anyAbs, type Abs } from "../abs.ts";
import { formatShape } from "../format.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../may-throw.ts";

function run(src: string, args: Abs[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, "f", args);
}

function val(src: string, args?: Abs[]) {
  return litValue(run(src, args).result);
}

function shape(src: string, args?: Abs[]) {
  return formatShape(run(src, args).result);
}

/** try/catch 吸收后返回 "RangeError"（对齐报告矩阵行体） */
function expectCaughtRangeError(src: string) {
  expect(val(src), `caught RangeError for: ${src}`).toEqual({ ok: true, value: "RangeError" });
}

/** 无 try/catch：入口 throws 面是 RangeError brand */
function expectThrowsRangeError(src: string) {
  const r = run(src);
  const name = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(name, `throws RangeError for: ${src}`).toBe("RangeError");
}

function check(src: string) {
  return checkSource("/t/eval-dataview.js", src);
}

/** L2 entry-may-throw issue 数（按函数名过滤可选） */
function l2Count(r: ReturnType<typeof check>, fn?: string): number {
  return r.issues.filter(
    (i) => i.code === "nudo:entry-may-throw" && (!fn || i.fn === fn),
  ).length;
}

/** 运行时 may-throw 效果 kind 集（args 可传 anyAbs 或空） */
function effects(src: string, args: Abs[]): string[] {
  const exports = runTranspiled(src, { mode: "analyze" });
  const eff: MayThrowEffect[] = [];
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => eff.push(e));
    try {
      callTranspiledExportFull(exports, "f", args);
    } catch {
      /* 入口整抛：效果经 throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  return [...new Set(eff.map((e) => e.kind))];
}

const DV8 = `new DataView(new ArrayBuffer(8))`;
const caught = (expr: string) =>
  `export function f() { try { ${expr}; return "no-throw"; } catch (e) { return e.constructor.name; } }`;

describe("Bug 35：get/set 全族越界定抛 RangeError（8 字节视图）", () => {
  // partial-read 偏移（元素宽越出视图尾）+ 远越界
  it.each([
    ["getInt8(8)", `${DV8}.getInt8(8)`],
    ["getUint8(8)", `${DV8}.getUint8(8)`],
    ["getInt16(7)", `${DV8}.getInt16(7)`],
    ["getUint16(7)", `${DV8}.getUint16(7)`],
    ["getFloat16(7)", `${DV8}.getFloat16(7)`],
    ["getInt32(5)", `${DV8}.getInt32(5)`],
    ["getUint32(5)", `${DV8}.getUint32(5)`],
    ["getFloat32(5)", `${DV8}.getFloat32(5)`],
    ["getFloat64(4)", `${DV8}.getFloat64(4)`],
    ["getBigInt64(1)", `${DV8}.getBigInt64(1)`],
    ["getBigUint64(1)", `${DV8}.getBigUint64(1)`],
    ["getUint8(100)", `${DV8}.getUint8(100)`],
  ])("%s → RangeError", (_name, expr) => {
    expectCaughtRangeError(caught(expr));
    expectThrowsRangeError(`export function f() { ${expr}; }`);
  });

  it.each([
    ["setInt8(-1, 1)", `${DV8}.setInt8(-1, 1)`], // 方法 byteOffset 过 ToIndex（负 → RangeError）
    ["setUint8(100, 1)", `${DV8}.setUint8(100, 1)`],
    ["setInt16(7, 1)", `${DV8}.setInt16(7, 1)`],
    ["setUint16(7, 1)", `${DV8}.setUint16(7, 1)`],
    ["setFloat16(7, 1)", `${DV8}.setFloat16(7, 1)`],
    ["setInt32(5, 1)", `${DV8}.setInt32(5, 1)`],
    ["setUint32(5, 1)", `${DV8}.setUint32(5, 1)`],
    ["setFloat32(5, 1)", `${DV8}.setFloat32(5, 1)`],
    ["setFloat64(4, 1)", `${DV8}.setFloat64(4, 1)`],
    ["setBigInt64(1, 1n)", `${DV8}.setBigInt64(1, 1n)`],
    ["setBigUint64(1, 1n)", `${DV8}.setBigUint64(1, 1n)`],
  ])("%s → RangeError", (_name, expr) => {
    expectCaughtRangeError(caught(expr));
    expectThrowsRangeError(`export function f() { ${expr}; }`);
  });

  it("边界合法读不抛（最后一个合法字节）+ 读返回域按元素类型", () => {
    expect(shape(`export function f() { return ${DV8}.getUint8(7); }`)).toBe("number");
    expect(shape(`export function f() { return ${DV8}.getInt16(6); }`)).toBe("number");
    expect(shape(`export function f() { return ${DV8}.getFloat64(0); }`)).toBe("number");
    expect(shape(`export function f() { return ${DV8}.getBigInt64(0); }`)).toBe("bigint");
    expect(shape(`export function f() { return ${DV8}.getBigUint64(0); }`)).toBe("bigint");
    // littleEndian 实参 ToBoolean 恒不抛、不影响域
    expect(shape(`export function f() { return ${DV8}.getUint16(0, true); }`)).toBe("number");
  });

  it("写返回 undefined；缺省/undefined byteOffset → ToIndex 0 合法", () => {
    expect(shape(`export function f() { return ${DV8}.setUint8(7, 1); }`)).toBe("undefined");
    expect(shape(`export function f() { return ${DV8}.setFloat64(0, 1); }`)).toBe("undefined");
    expect(shape(`export function f() { return ${DV8}.getUint8(); }`)).toBe("number");
    expect(shape(`export function f() { return ${DV8}.getUint8(undefined); }`)).toBe("number");
    expect(shape(`export function f() { return ${DV8}.setUint8(0); }`)).toBe("undefined");
  });

  it("方法 byteOffset 过 ToIndex：负 → RangeError（同 ctor 口径）", () => {
    expectCaughtRangeError(caught(`${DV8}.getUint8(-1)`));
    expectCaughtRangeError(caught(`${DV8}.setFloat64(-2, 1)`));
  });

  it("子视图按视图 byteLength（非 buffer）判界", () => {
    const sub = `new DataView(new ArrayBuffer(8), 4, 2)`;
    expect(shape(`export function f() { return ${sub}.getUint8(1); }`)).toBe("number");
    expectCaughtRangeError(caught(`${sub}.getUint8(2)`));
    expectCaughtRangeError(caught(`${sub}.getUint8(3)`)); // 相对 buffer 未越界、相对视图越界
  });
});

describe("Bug 35：构造器越界（byteOffset/byteLength 相对缓冲区）", () => {
  it.each([
    ["(buf8, 100)", `new DataView(new ArrayBuffer(8), 100)`], // byteOffset OOB
    ["(buf8, 9)", `new DataView(new ArrayBuffer(8), 9)`], // 电池形态
    ["(buf8, 4, 100)", `new DataView(new ArrayBuffer(8), 4, 100)`], // byteLength OOB
    ["(buf8, 4, 8)", `new DataView(new ArrayBuffer(8), 4, 8)`], // 电池形态：4+8 > 8
  ])("ctor %s → RangeError", (_name, expr) => {
    expectCaughtRangeError(caught(expr));
    expectThrowsRangeError(`export function f() { ${expr}; }`);
  });

  it("合法构造不回退（槽折叠 + brand 形态）", () => {
    expect(val(`export function f() { return new DataView(new ArrayBuffer(8)).byteLength; }`))
      .toEqual({ ok: true, value: 8 });
    expect(val(`export function f() { return new DataView(new ArrayBuffer(8), 4).byteLength; }`))
      .toEqual({ ok: true, value: 4 });
    expect(val(`export function f() { return new DataView(new ArrayBuffer(8), 4).byteOffset; }`))
      .toEqual({ ok: true, value: 4 });
    // off = bufLen 的空视图合法（native byteLength 0）
    expect(val(`export function f() { return new DataView(new ArrayBuffer(8), 8).byteLength; }`))
      .toEqual({ ok: true, value: 0 });
    // 报告矩阵控制组
    expect(val(`export function f() { return new DataView(new ArrayBuffer(8), undefined, 4).byteOffset; }`))
      .toEqual({ ok: true, value: 0 });
    // byteLength 显式 undefined ≡ 缺省（填满缓冲区，node 实测 6；先判 undefined 再 ToIndex）
    expect(val(`export function f() { return new DataView(new ArrayBuffer(8), 2, undefined).byteLength; }`))
      .toEqual({ ok: true, value: 6 });
    // null 仍走 ToIndex → 0（node 实测）
    expect(val(`export function f() { return new DataView(new ArrayBuffer(8), 2, null).byteLength; }`))
      .toEqual({ ok: true, value: 0 });
    const r = run(`export function f() { return new DataView(new ArrayBuffer(8)); }`);
    expect(r.result.shape.k === "brand" && (r.result.shape as { name?: string }).name).toBe("DataView");
  });

  it("既有口径控制组：ToIndex 负偏移 / 非 buffer 接收者", () => {
    expectCaughtRangeError(caught(`new DataView(new ArrayBuffer(8), -1)`));
    const t = run(`export function f() { return new DataView(1); }`).throws;
    expect(t?.shape?.k === "brand" && (t as { shape: { name?: string } }).shape.name).toBe("TypeError");
  });
});

describe("Bug 35：抽象面 may RangeError + L2 gate 假阴修复", () => {
  it("抽象 byteOffset（any 实参）→ may RangeError（get/set 两面）", () => {
    expect(effects(`export function f(x) { return ${DV8}.getFloat64(x); }`, [anyAbs])).toContain("RangeError");
    expect(effects(`export function f(x) { return ${DV8}.setUint8(x, 1); }`, [anyAbs])).toContain("RangeError");
  });

  it("抽象视图（any buffer）→ may RangeError（视图长度不可判）", () => {
    expect(effects(`export function f(x) { return new DataView(x).getUint8(0); }`, [anyAbs])).toContain("RangeError");
  });

  it("ctor 抽象 byteOffset 控制组（既有 ToIndex may，不回退）", () => {
    expect(effects(`export function f(x) { return new DataView(new ArrayBuffer(8), x); }`, [anyAbs])).toContain("RangeError");
  });

  it("合法字面量链路零 may（不引入假阳）", () => {
    expect(effects(`export function f() { return ${DV8}.getUint8(0); }`, [])).toEqual([]);
    expect(effects(`export function f() { const dv = new DataView(new ArrayBuffer(8), 2); return dv.setUint8(1, 7); }`, [])).toEqual([]);
    expect(effects(`export function f(x) { return new DataView(x); }`, [anyAbs])).toEqual(["TypeError"]);
  });

  it("L2 gate：entry 未消化的抽象越界读/写被标记（此前假阴）", () => {
    expect(l2Count(check(`export function g(x) { return ${DV8}.getFloat64(x); }`), "g")).toBeGreaterThan(0);
    expect(l2Count(check(`export function g(x) { return ${DV8}.setUint8(x, 1); }`), "g")).toBeGreaterThan(0);
    // ctor 抽象 offset 控制组（既有 FLAGGED，不回退）
    expect(l2Count(check(`export function g(x) { return new DataView(new ArrayBuffer(8), x); }`), "g")).toBeGreaterThan(0);
  });

  it("L2 gate 负控制：字面量边界内访问不标记", () => {
    expect(l2Count(check(`export function g() { return ${DV8}.getUint8(7); }`), "g")).toBe(0);
    expect(l2Count(check(`export function g() { const dv = new DataView(new ArrayBuffer(8), 4, 2); return dv.setUint8(1, 1); }`), "g")).toBe(0);
  });
});
