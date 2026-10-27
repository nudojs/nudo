/**
 * 运行时「宿主哨兵」回归（PR fix/core 评审 D1/D2）：
 *
 * D1 —— `$set` 对空值接收者不得炸宿主。
 *   DEC-006 B/C 契约：非 Abs 目标 fail-closed **返回原接收者**（调用点
 *   `root = $set(root, …)` 重绑为自赋值 no-op），禁止读 `.shape` 炸宿主
 *   TypeError（`$get` 同口径）。此前宿主写面用 `undefined` 哨兵表示
 *   「处理器未命中」，而 fail-closed 的返回值**就是原接收者**——可能正是
 *   `undefined` ⇒ 与哨兵同形 ⇒ 落穿到 `switch (o.shape.k)` 读 undefined
 *   的宿主 TypeError（`$set(null, …)` 因 null ≠ undefined 侥幸不炸）。
 *   修法：宿主写面的处置信号改为判别对象（hit/value），未命中与
 *   fail-closed 不再同形。`$get` 语义不变。
 *
 * D2 —— `$switch` 的隐式 no-match 臂不得贡献 yield 收集器。
 *   臂协议共用 `beginSwitchArms()`：每个臂都过 `withIsolatedYields` 并把
 *   收集器记进臂列表；`mergeArmYields` 按**非 null 收集器个数**分流——
 *   隐式臂的空收集器把「单臂 switch」翻成多臂 join（`genPathSensitive++`
 *   + `genJoinOverride`）⇒ `$gen` 的元素类型降 unknown。native 侧单臂
 *   switch 的 yield 元素是精确字面量（`switch (x) { case 1: yield "a" }`
 *   ⇒ "a"）。修法：隐式臂记 null（同 `$fork` 隐式 else 口径）。
 *   多臂 switch 行为**不变**（仍走多臂 join）。
 */
import { describe, it, expect } from "vitest";
import { $set, $get } from "../runtime/containers/member.ts";
import { $obj } from "../runtime/containers/obj.ts";
import { $lit, asAbsVal } from "../runtime/state.ts";
import { markExtState } from "../../builtins.ts";
import { anyAbs, litValue, type Abs } from "../../abs.ts";
import { runTranspiled, callTranspiledExportFull } from "../run.ts";

/** 空值接收者：运行时可能是宿主 undefined（DEC-006 fail-closed 目标） */
const hostUndefined = undefined as never;
const hostNull = null as never;

/** 调用导出函数并取结果 Abs */
function callAbs(src: string, fnName: string, args: Abs[] = []): Abs {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args).result;
}

/** 生成器对象的第 0 个 yield 元素（内部槽面，$get 直读） */
function genFirstYield(src: string): Abs {
  return $get(callAbs(src, "g", [anyAbs]), "0");
}

/** 字面量值（ok=false ⇒ undefined） */
function litOf(a: Abs): unknown {
  const lv = litValue(a);
  return lv.ok ? lv.value : undefined;
}

describe("D1: $set 空值接收者 fail-closed（不得炸宿主）", () => {
  it("$set(undefined, 'x') 返回原接收者，不抛宿主 TypeError", () => {
    let out: Abs | undefined;
    expect(() => {
      out = $set(hostUndefined, "x", $lit(1));
    }).not.toThrow();
    expect(out).toBeUndefined();
  });

  it("$set(null, 'x') 返回原接收者（null），语义不变", () => {
    const out = $set(hostNull, "x", $lit(1));
    expect(out).toBeNull();
  });

  it("$get(undefined, 'x') 语义不变（unknown Abs，非宿主异常）", () => {
    const g = $get(hostUndefined, "x");
    expect(g).toBeTruthy();
    expect((g as Abs).shape.k).toBe("unknown");
    const gn = $get(hostNull, "x");
    expect((gn as Abs).shape.k).toBe("unknown");
  });

  it("Abs 目标写面不变：obj 槽就地写、Abs 身份不变", () => {
    const o = $obj({ a: $lit(1) });
    const out = $set(o, "b", $lit(2));
    expect(out).toBe(o);
    const b = $get(o, "b");
    expect(litOf(b)).toBe(2);
  });

  it("宿主函数 prototype 写仍建 facade（原型替换可观测）", () => {
    const hostFn = function hostFn(): void {};
    const facade = $set(hostFn as never, "prototype", $obj({ z: $lit(9) }));
    expect(facade).not.toBe(hostFn as never);
    expect((facade as Abs).shape.k).toBe("fn");
    const proto = $get(facade, "prototype");
    expect((proto as Abs).shape.k).toBe("obj");
    expect(litOf($get(proto, "z"))).toBe(9);
  });

  it("frozen 宿主函数写仍定抛 TypeError（不可扩展门不因协议改动而失效）", () => {
    const hostFn = function hostFn(): void {};
    markExtState(asAbsVal(hostFn), "frozen");
    expect(() => $set(hostFn as never, "x", $lit(1))).toThrow();
  });
});

describe("D2: $switch 隐式 no-match 臂不贡献 yield 收集器", () => {
  it("单臂 switch：yield 元素保持精确字面量（native \"a\"）", () => {
    const el = genFirstYield(`export function* g(x) { switch (x) { case 1: yield "a"; } }`);
    expect(el.shape.k).toBe("prim");
    expect((el.shape as { type?: string }).type).toBe("string");
    expect(litOf(el)).toBe("a");
    expect(el.conf).toBe("exact");
  });

  it("if 形态不变（同样精确）", () => {
    const el = genFirstYield(`export function* g(x) { if (x === 1) yield "a"; }`);
    expect(litOf(el)).toBe("a");
    expect(el.conf).toBe("exact");
  });

  it("字面量判别式的 switch 不变（精确）", () => {
    const el = genFirstYield(`export function* g(x) { switch (1) { case 1: yield "a"; } }`);
    expect(litOf(el)).toBe("a");
    expect(el.conf).toBe("exact");
  });

  it("多臂 switch 行为不变（仍走多臂 join ⇒ 元素 unknown）", () => {
    const el = genFirstYield(`export function* g(x) { switch (x) { case 1: yield "a"; case 2: yield "b"; } }`);
    expect(el.shape.k).toBe("unknown");
  });

  it("隐式 no-match 臂仍参与返回域（undefined | 5）", () => {
    const out = callAbs(`export function f(x) { switch (x) { case 1: return 5; } }`, "f", [anyAbs]);
    // 返回域含隐式臂的 undefined 与 case 臂的 5（隐式臂不得被整体丢弃）
    expect(out.shape.k).toBe("sum");
    const members = (out.shape as { members: Abs[] }).members;
    const lits = members.map((m) => litValue(m));
    expect(lits.some((l) => l.ok && l.value === 5)).toBe(true);
    expect(lits.some((l) => l.ok && l.value === undefined)).toBe(true);
  });
});
