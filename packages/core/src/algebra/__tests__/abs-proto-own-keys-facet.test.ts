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
import { protoBrandAbs } from "../builtins/ctor.ts";
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

  it("负控：未建模原型不挂槽位 ⇒ 既有保守域逐字不变", () => {
    expect(protoBrandAbs("Array").facets?.protoOwnKeys).toBeUndefined();
    expect(protoBrandAbs("Object").facets?.protoOwnKeys).toBeUndefined();
    const names = call(wrap("return Object.getOwnPropertyNames(Array.prototype);")).result;
    expect(formatShape(names)).toBe("string[]");
    const hasOwn = call(wrap('return Object.hasOwn(Object.prototype, "toString");')).result;
    expect(formatShape(hasOwn)).toBe("boolean");
    expect(litValue(hasOwn).ok).toBe(false);
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

  it("符号键：显式携带 symbols 时精确投影；未携带仍保守 arr<symbol>", () => {
    withProtoKeys("Array", { strings: [], symbols: [] }, () => {
      const r = call(wrap("return Object.getOwnPropertySymbols(Array.prototype);")).result;
      expect((r as Abs).shape.k).toBe("tuple");
      expect(((r as Abs).shape as { elements: unknown[] }).elements).toHaveLength(0);
    });
    const conservative = call(wrap("return Object.getOwnPropertySymbols(Array.prototype);")).result;
    expect(formatShape(conservative)).toBe("symbol[]");
  });

  it("负控：清理槽位后既有保守域回来（单例无污染）", () => {
    const nativeKeys = Object.getOwnPropertyNames(Array.prototype);
    withProtoKeys("Array", { strings: nativeKeys }, () => {
      expect(protoBrandAbs("Array").facets?.protoOwnKeys?.strings).toEqual(nativeKeys);
    });
    expect("facets" in protoBrandAbs("Array")).toBe(false);
    expect(formatShape(call(wrap("return Object.getOwnPropertyNames(Array.prototype);")).result)).toBe(
      "string[]",
    );
  });
});
