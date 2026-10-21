/**
 * Bug 303 回归：new <TypedArray>(buffer) 缺省长度——「buffer 剩余字节数须为
 * 元素大小整数倍」的 RangeError 检查。
 *
 * 原生 AllocateTypedArrayBuffer（node v26 实测）：
 *   new Int32Array(new ArrayBuffer(6))  → RangeError（byte length 须是 4 的倍数）
 *   new Float64Array(new ArrayBuffer(9)) → RangeError
 *   new Int16Array(new ArrayBuffer(3))  → RangeError
 *   new Int32Array(new ArrayBuffer(9), 4) → RangeError（剩余 5 字节非倍数）
 *   new Int32Array(new ArrayBuffer(8), 4) → length 1（剩余 4 字节，合法）
 * 引擎此前只判「offset 越界」与「offset 对齐」两道，缺省长度臂整支缺失 ⇒
 * Math.floor 静默截断折出**确定的错长度**（buf6 → 1），且门禁恒绿。
 *
 * 修法：binary.ts makeTypedArrayFromBuffer 的 lenDefaulted 分支补
 * `(bufLenV - offV) % bpe !== 0 → RangeError`；bufLen 不可判 → may RangeError。
 */
import { describe, it, expect } from "vitest";
import { call, val, effects } from "./eval-helpers.ts";
import { l2Count } from "./nudo-constraints.ts";
import { checkSource } from "../check.ts";

/** 原生：定抛（try/catch 吸收后返回 "caught"） */
function expectCaught(src: string) {
  expect(val(src), `caught for: ${src}`).toEqual({ ok: true, value: "caught" });
}

/** 定抛：无 try/catch 时 throws 面是相应 Error brand */
function expectThrows(src: string, name: string) {
  const r = call(src);
  const got = r.throws?.shape?.k === "brand"
    ? (r.throws as { shape: { name: string } }).shape.name
    : r.throws?.shape?.k;
  expect(got, `throws ${name} for: ${src}`).toBe(name);
}

function check(src: string) {
  return checkSource("/t/eval-bug-303.js", src);
}

// ---------------------------------------------------------------------------
// 改前会失败的形态：非整数倍尾段 → definite RangeError
// ---------------------------------------------------------------------------

describe("Bug 303：TA buffer 形态缺省长度非整数倍 → definite RangeError", () => {
  it.each([
    ["Int32Array / 6 字节", `const b = new ArrayBuffer(6); return new Int32Array(b).length;`],
    ["Float64Array / 9 字节", `const b = new ArrayBuffer(9); return new Float64Array(b).length;`],
    ["Int16Array / 3 字节", `const b = new ArrayBuffer(3); return new Int16Array(b).length;`],
    ["Int32Array / 9 字节 off 4（剩余 5）", `const b = new ArrayBuffer(9); return new Int32Array(b, 4).length;`],
    ["BigInt64Array / 12 字节", `const b = new ArrayBuffer(12); return new BigInt64Array(b).length;`],
    ["SharedArrayBuffer / 6 字节", `const b = new SharedArrayBuffer(6); return new Int32Array(b).length;`],
    ["Uint16Array / 5 字节", `const b = new ArrayBuffer(5); return new Uint16Array(b).length;`],
    ["Float32Array / 10 字节", `const b = new ArrayBuffer(10); return new Float32Array(b).length;`],
  ])("%s → RangeError", (_name, body) => {
    expectThrows(`export function f() { ${body} }`, "RangeError");
    expectCaught(`export function f() { try { ${body}; return "no-throw"; } catch (e) { return "caught"; } }`);
  });

  it("构造期 RangeError 进 throws 域（此前 throws=never 假 total）", () => {
    const r = call(`export function f() { const b = new ArrayBuffer(6); return new Int32Array(b).length; }`);
    expect(r.result.shape.k).toBe("never");
  });
});

// ---------------------------------------------------------------------------
// 负控制：整数倍尾段 / 显式长度 / 对齐与越界档——不得被本修复波及
// ---------------------------------------------------------------------------

describe("Bug 303 负控制：合法 buffer 形态不回退", () => {
  it.each([
    ["Int32Array / 8 字节 → 2", `const b = new ArrayBuffer(8); return new Int32Array(b).length;`, 2],
    ["Int32Array / 8 字节 off 4 → 1", `const b = new ArrayBuffer(8); return new Int32Array(b, 4).length;`, 1],
    ["Int32Array / 12 字节 off 4 → 2", `const b = new ArrayBuffer(12); return new Int32Array(b, 4).length;`, 2],
    ["Uint8Array / 6 字节 → 6（BPE=1 恒整除）", `const b = new ArrayBuffer(6); return new Uint8Array(b).length;`, 6],
    ["Uint8Array / 3 字节 off 1 → 2", `const b = new ArrayBuffer(3); return new Uint8Array(b, 1).length;`, 2],
    ["BigInt64Array / 16 字节 → 2", `const b = new ArrayBuffer(16); return new BigInt64Array(b).length;`, 2],
    ["Float16Array / 6 字节 → 3", `const b = new ArrayBuffer(6); return new Float16Array(b).length;`, 3],
    ["Int32Array / 0 字节 → 0", `const b = new ArrayBuffer(0); return new Int32Array(b).length;`, 0],
    ["Int32Array / 4 字节 off 4 → 0", `const b = new ArrayBuffer(4); return new Int32Array(b, 4).length;`, 0],
  ])("%s", (_name, body, expected) => {
    expect(val(`export function f() { ${body} }`)).toEqual({ ok: true, value: expected });
  });

  it("显式 byteLength 臂不查整除（原生同：new Int32Array(buf6, 0, 1) → 1）", () => {
    expect(val(`export function f() { const b = new ArrayBuffer(6); return new Int32Array(b, 0, 1).length; }`))
      .toEqual({ ok: true, value: 1 });
    // 显式长度越界仍是 RangeError（既有 Bug 101 档不回退）
    expectThrows(
      `export function f() { const b = new ArrayBuffer(6); return new Int32Array(b, 4, 1).length; }`,
      "RangeError",
    );
  });

  it("offset 对齐档先于整除档（原生报错序：Int32(buf6, 2) → 偏移未对齐）", () => {
    expectThrows(
      `export function f() { const b = new ArrayBuffer(6); return new Int32Array(b, 2).length; }`,
      "RangeError",
    );
  });
});

// ---------------------------------------------------------------------------
// 门禁面：抽象 buffer 长度 → may RangeError（不误报定抛）
// ---------------------------------------------------------------------------

describe("Bug 303 gate 面", () => {
  it("抽象 buffer byteLength（缺省长度臂整除不可判）→ may RangeError", () => {
    const src = `export function f(x) { const b = new ArrayBuffer(x); return new Int32Array(b).length; }`;
    expect(effects(src)).toContain("RangeError");
  });

  it("抽象 buffer byteLength + 显式长度 → may RangeError（既有越界档）", () => {
    const src = `export function f(x) { const b = new ArrayBuffer(x); return new Int32Array(b, 0, 1).length; }`;
    expect(effects(src)).toContain("RangeError");
  });

  it("定抛臂进 L2（entry-may-throw 记账）", () => {
    const src = `export function f() { const b = new ArrayBuffer(6); return new Int32Array(b).length; }`;
    expect(l2Count(check(src))).toBeGreaterThan(0);
  });
});
