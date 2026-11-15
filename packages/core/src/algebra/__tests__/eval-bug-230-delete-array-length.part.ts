// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): eval-bug-230-delete-array-length.test.ts + eval-bug-230-proxy-delete-invariant.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { litValue } from "../abs.ts";
import { call, isNever, throwsError } from "./eval-helpers.ts";

describe("[merged] eval-bug-230-delete-array-length.test.ts", () => {
/**
 * Bug 230：`delete a.length` 不抛 TypeError（原生 strict：不可配置自有属性
 * → TypeError）→ 引擎把删除当成成功（`true`）→ 门禁假绿。
 *
 * 根因：`delete` 的两个通道都在 `exec/runtime/members.ts`
 * （`$del` 语句位写回 / `$delRes` 表达式值）——两者都没判「数组 length 是
 * **不可配置**自有属性」；`$delRes` 的 tuple 臂只查 `canonicalArrayIndex`
 * （"length" → undefined → 放行）⇒ 引擎把删除当成功（返回 `true`）。
 *
 * 修法（exec/runtime/members.ts + exec/runtime/array-length.ts 的判定接口
 * `arrayLengthIsNonConfigurable(o, key)`）：`$delRes` 与 `$del` 各加一行
 * `if (arrayLengthIsNonConfigurable(o, key)) throwStrictWrite();`
 * ——须放在 `st === "frozen" || st === "sealed"` 分支**之前**（数组 length
 * 与冻结档无关；否则 nonext 数组的 delete a.length 会被放行）。
 */




function v(src: string) {
  return litValue(call(src, "f").result);
}

function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 230: delete a.length 必抛 TypeError", () => {
  it("delete a.length → TypeError（表达式位：不可配置自有属性）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        const r = delete a.length;
        return [r, a.length];
      }`),
    ).toBe(true);
  });

  it("delete a.length → TypeError（语句位写回通道 $del）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        delete a.length;
        return a.length;
      }`),
    ).toBe(true);
  });

  it("delete a[\"length\"]（计算键）→ TypeError", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        const r = delete a["length"];
        return [r, a.length];
      }`),
    ).toBe(true);
  });

  it("负控制：preventExtensions 数组 delete a.length → 仍 TypeError（length 恒不可配置）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2, 3];
        Object.preventExtensions(a);
        delete a.length;
        return "nothrow";
      }`),
    ).toBe(true);
  });

  it("负控制：delete a[0]（元素可配置）→ true", () => {
    expect(
      v(`export function f() {
        const a = [1, 2, 3];
        const r = delete a[0];
        return r;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("负控制：delete 普通对象自有属性 → true", () => {
    expect(
      v(`export function f() {
        const o = { x: 1 };
        const r = delete o.x;
        return r;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("负控制：delete 不存在的属性 → true", () => {
    expect(
      v(`export function f() {
        const o = { x: 1 };
        const r = delete o.zzz;
        return r;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("负控制：delete 普通对象的 length 属性（可配置）→ true（数组专属规则）", () => {
    expect(
      v(`export function f() {
        const o = { length: 5 };
        const r = delete o.length;
        return r;
      }`),
    ).toEqual({ ok: true, value: true });
  });

  it("负控制：frozen 对象删自有属性 → TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const o = Object.freeze({ x: 1 });
        delete o.x;
        return "nothrow";
      }`),
    ).toBe(true);
  });
});
});

describe("[merged] eval-bug-230-proxy-delete-invariant.test.ts", () => {
/**
 * Bug 230 回归（**Proxy [[Delete]] 不变量** + **字符串 prim 的 length 删除门**）：
 *
 * ① Proxy [[Delete]] 规范不变量（ES2024 10.5.9 step 10）——deleteProperty
 *    陷阱返回 **true** 时，若靶上该键是**不可配置**自有属性 ⇒ 原生定抛
 *    TypeError。此前引擎直接返 true（假绿：原生必抛的写门被当成"删除成功"）。
 *    落点：builtins/reflect.ts 的 Reflect.deleteProperty 臂（陷阱结果算出
 *    后过 builtins/object/descriptor.ts 的 enforceProxyDeleteInvariant）；
 *    `delete p.x` **运算符**路径（exec/runtime/members.ts 的 $delRes）已接线。
 *
 * ② `delete s.length`（**字符串 prim** 接收者）：String 包装对象的 length 是
 *    **不可配置**自有属性 ⇒ strict（ESM）下恒 TypeError。此前 prim 臂不拦
 *    ⇒ 引擎折 unknown（假绿）。落点：exec/runtime/array-length.ts 的
 *    arrayLengthIsNonConfigurable（prim 臂补齐）。
 */




function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 定抛探针：结果 never + throws 面是指定错误类型 */
function threw(src: string, name = "TypeError"): boolean {
  const r = call(src, "f");
  return isNever(r.result) && throwsError(r.throws, name);
}

describe("Bug 230 — Proxy [[Delete]] 不变量（不可配置属性）", () => {
  it("Reflect.deleteProperty(靶含不可配置键, 陷阱返 true) → TypeError", () => {
    expect(
      threw(`export function f() {
        const t = {};
        Object.defineProperty(t, "x", { value: 1, configurable: false });
        const p = new Proxy(t, { deleteProperty: () => true });
        Reflect.deleteProperty(p, "x");
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：靶上该键可配置 → 返 true（不抛）", () => {
    expect(
      v(`export function f() {
        const t = { x: 1 };
        const p = new Proxy(t, { deleteProperty: () => true });
        return String(Reflect.deleteProperty(p, "x"));
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制：靶上无该键 → 返 true（不抛）", () => {
    expect(
      v(`export function f() {
        const t = {};
        const p = new Proxy(t, { deleteProperty: () => true });
        return String(Reflect.deleteProperty(p, "nope"));
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制：陷阱返 false → 返 false（不抛；原生不变量不适用）", () => {
    expect(
      v(`export function f() {
        const t = {};
        Object.defineProperty(t, "x", { value: 1, configurable: false });
        const p = new Proxy(t, { deleteProperty: () => false });
        return String(Reflect.deleteProperty(p, "x"));
      }`),
    ).toEqual({ ok: true, value: "false" });
  });

  it("delete p.x（运算符路径）→ TypeError（exec/runtime/members.ts 的 $delRes 陷阱臂过 enforceProxyDeleteInvariant）", () => {
    expect(
      threw(`export function f() {
        const t = {};
        Object.defineProperty(t, "x", { value: 1, configurable: false });
        const p = new Proxy(t, { deleteProperty: () => true });
        delete p.x;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制（运算符路径）：靶上该键可配置 → 返 true（不抛）", () => {
    expect(
      v(`export function f() {
        const t = { x: 1 };
        const p = new Proxy(t, { deleteProperty: () => true });
        return String(delete p.x);
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制（运算符路径）：靶上无该键 → 返 true（不抛）", () => {
    expect(
      v(`export function f() {
        const t = {};
        const p = new Proxy(t, { deleteProperty: () => true });
        return String(delete p.nope);
      }`),
    ).toEqual({ ok: true, value: "true" });
  });

  it("负控制（运算符路径）：陷阱返 false → strict 定抛 TypeError（原生同）", () => {
    expect(
      threw(`export function f() {
        const t = {};
        Object.defineProperty(t, "x", { value: 1, configurable: false });
        const p = new Proxy(t, { deleteProperty: () => false });
        delete p.x;
        return "no-throw";
      }`),
    ).toBe(true);
  });
});

describe("Bug 230 — delete s.length（字符串 prim 接收者）", () => {
  it("delete 字符串字面量的 length → TypeError（此前折 unknown）", () => {
    expect(
      threw(`export function f() {
        const s = "ab";
        delete s.length;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：delete 数组的 length → TypeError（既有正确）", () => {
    expect(
      threw(`export function f() {
        const a = [1, 2];
        delete a.length;
        return "no-throw";
      }`),
    ).toBe(true);
  });

  it("负控制：delete 字符串的其它键 → 不抛（length 之外的键不受管）", () => {
    expect(
      threw(`export function f() {
        const s = "ab";
        delete s.other;
        return "no-throw";
      }`),
    ).toBe(false);
  });
});
});
