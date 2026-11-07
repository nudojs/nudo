/**
 * A10 · `protoOwnKeys` 槽位启用的回归钉。
 *
 * 对应 docs/design/architecture-debt.md「剩余槽位的受控 major 执行方案」步骤 2：
 * - 生产：`protoBrandAbs` / `generatorProtoBrandOf` 把已精确建模的键集随值携带；
 * - 消费：`protoOwnKeysOf` 优先读槽位，缺省回落按名表（既有保守域逐字不变）；
 * - 搬运：subst / snapshot / join 整包带走（步骤 1 + join 补齐）。
 *
 * 验收口径：**空槽位下所有既有行为不变**；挂了槽位的值由「保守域」升为
 * 「与宿主原生对拍的精确面」。所有对单例原型的装配都在 finally 里精确恢复
 * （槽位缺省时不留下 `facets: undefined` 属性）。
 */
import { describe, it, expect } from "vitest";
import { abs, litValue, type Abs, type AbsFacets } from "../abs.ts";
import { objOf } from "../objects.ts";
import { snapshotAbs } from "../hof.ts";
import { objectProtoBrand, protoBrandAbs } from "../builtins/ctor.ts";
import { protoOwnKeysOf } from "../exec/runtime/brand-tables.ts";
import { builtinBrandOwnKeyNames } from "../builtins/object/enum-entries.ts";
import { call, tupleEls } from "./eval-helpers.ts";
import { formatShape } from "../format/format.ts";

type OwnKeys = NonNullable<AbsFacets["protoOwnKeys"]>;

const wrap = (body: string) => `export function f() { ${body} }`;

/** 临时给按名驻留的原型单例挂键集；finally 精确恢复（含「本来没有」）。 */
function withProtoKeys<T>(name: string, keys: OwnKeys, fn: () => T): T {
  const proto = protoBrandAbs(name);
  const saved = proto.facets;
  proto.facets = { ...(saved ?? {}), protoOwnKeys: keys };
  try {
    return fn();
  } finally {
    if (saved === undefined) delete proto.facets;
    else proto.facets = saved;
  }
}

describe("A10 · protoOwnKeys 生产点", () => {
  it("Error.prototype 的精确键集随值携带，且与按名表一致", () => {
    const p = protoBrandAbs("Error");
    const keys = ["constructor", "name", "message", "toString"];
    expect(p.facets?.protoOwnKeys?.strings).toEqual(keys);
    expect(protoOwnKeysOf(p)?.strings).toEqual(keys);
  });

  it("A10 残余：内建原型挂宿主键集 ⇒ gOPN / hasOwn 升为与原生对拍的精确面", () => {
    const nativeArray = Object.getOwnPropertyNames(Array.prototype);
    const nativeObject = Object.getOwnPropertyNames(Object.prototype);
    expect(protoBrandAbs("Array").facets?.protoOwnKeys?.strings).toEqual(nativeArray);
    expect(objectProtoBrand().facets?.protoOwnKeys?.strings).toEqual(nativeObject);
    const names = call(wrap("return Object.getOwnPropertyNames(Array.prototype);")).result;
    expect(tupleEls(names)).toEqual(nativeArray);
    expect(
      litValue(call(wrap('return Object.hasOwn(Object.prototype, "toString");')).result),
    ).toEqual({ ok: true, value: true });
    expect(
      litValue(call(wrap('return Object.hasOwn(Object.prototype, "__nope__");')).result),
    ).toEqual({ ok: true, value: false });
  });

  it("A10 残余：多个内建原型的自有键集与宿主逐一对拍", () => {
    const names = [
      "Array", "Map", "Set", "WeakMap", "WeakSet", "Promise",
      "String", "Number", "Boolean", "BigInt", "Symbol",
      "Date", "RegExp",
    ];
    const globals = globalThis as unknown as Record<string, { prototype: object }>;
    for (const name of names) {
      const ctor = globals[name]!;
      const carried = protoBrandAbs(name).facets?.protoOwnKeys;
      expect(carried?.strings, name).toEqual(Object.getOwnPropertyNames(ctor.prototype));
      expect(carried?.symbols, name).toEqual(
        Object.getOwnPropertySymbols(ctor.prototype).map(String),
      );
    }
    // Object.prototype 走 objectProtoBrand 单例，单独对拍
    expect(objectProtoBrand().facets?.protoOwnKeys?.strings).toEqual(
      Object.getOwnPropertyNames(Object.prototype),
    );
    // 端到端：未建模原型上的成员判定也从保守 boolean 升为确定值
    expect(litValue(call(wrap('return Object.hasOwn(Map.prototype, "get");')).result)).toEqual({
      ok: true,
      value: true,
    });
    expect(
      litValue(call(wrap('return Object.hasOwn(Map.prototype, "__nope__");')).result),
    ).toEqual({ ok: true, value: false });
  });

  it("重建点：snapshotAbs 保留且深拷贝键集", () => {
    const p = protoBrandAbs("TypeError");
    const copy = snapshotAbs(p);
    expect(copy.facets?.protoOwnKeys?.strings).toEqual(p.facets?.protoOwnKeys?.strings);
    expect(copy.facets?.protoOwnKeys).not.toBe(p.facets?.protoOwnKeys);
  });
});

describe("A10 · protoOwnKeys 消费点（槽位优先于按名表）", () => {
  it("显式携带的键集覆盖按名表（按名表查不到的原型也能精确）", () => {
    const a: Abs = abs(
      { k: "brand", name: "Unknown.prototype", shape: objOf({}) },
      undefined,
      undefined,
      "exact",
    );
    expect(protoOwnKeysOf(a)).toBeUndefined();
    const carried: OwnKeys = { strings: ["alpha", "beta"], symbols: [] };
    a.facets = { protoOwnKeys: carried };
    expect(protoOwnKeysOf(a)).toBe(carried);
    expect(builtinBrandOwnKeyNames(a)).toEqual(["alpha", "beta"]);
  });

  it("gOPN：携带宿主真实键集后由保守 string[] 升为精确元组（与宿主对拍）", () => {
    const nativeKeys = Object.getOwnPropertyNames(Array.prototype);
    withProtoKeys("Array", { strings: nativeKeys }, () => {
      const r = call(wrap("return Object.getOwnPropertyNames(Array.prototype);")).result;
      expect((r as Abs).shape.k).toBe("tuple");
      expect(tupleEls(r)).toEqual(nativeKeys);
    });
  });

  it("hasOwn：携带键集后由保守 boolean 升为确定值（与宿主对拍）", () => {
    const nativeKeys = Object.getOwnPropertyNames(Array.prototype);
    withProtoKeys("Array", { strings: nativeKeys }, () => {
      expect(litValue(call(wrap('return Object.hasOwn(Array.prototype, "forEach");')).result)).toEqual({
        ok: true,
        value: true,
      });
      expect(litValue(call(wrap('return Object.hasOwn(Array.prototype, "__nope__");')).result)).toEqual({
        ok: true,
        value: false,
      });
    });
  });

  it("A10 残余：内建原型的 gOPS 与宿主符号键数对拍", () => {
    const n = Object.getOwnPropertySymbols(Array.prototype).length;
    const r = call(wrap("return Object.getOwnPropertySymbols(Array.prototype);")).result;
    expect((r as Abs).shape.k).toBe("tuple");
    expect(((r as Abs).shape as { elements: unknown[] }).elements).toHaveLength(n);
  });

  it("显式携带 symbols 仍可覆盖宿主键集（槽位优先）", () => {
    withProtoKeys("Array", { strings: [], symbols: [] }, () => {
      const r = call(wrap("return Object.getOwnPropertySymbols(Array.prototype);")).result;
      expect(((r as Abs).shape as { elements: unknown[] }).elements).toHaveLength(0);
    });
  });

  it("负控：withProtoKeys 的 finally 精确恢复单例原有键集（无污染）", () => {
    const saved = protoBrandAbs("Array").facets?.protoOwnKeys?.strings;
    withProtoKeys("Array", { strings: ["custom"] }, () => {
      expect(protoBrandAbs("Array").facets?.protoOwnKeys?.strings).toEqual(["custom"]);
    });
    expect(protoBrandAbs("Array").facets?.protoOwnKeys?.strings).toEqual(saved);
    expect(
      tupleEls(call(wrap("return Object.getOwnPropertyNames(Array.prototype);")).result),
    ).toEqual(Object.getOwnPropertyNames(Array.prototype));
  });
});
