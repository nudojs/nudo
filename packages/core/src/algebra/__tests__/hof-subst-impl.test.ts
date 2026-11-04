/**
 * A7 / Bug 810 引擎面回归：`substAbs` 重建 fn Shape 时必须搬运 impl 侧表。
 *
 * 改前（debt A7）：`substShape` case "fn" 只重建形状 ⇒ impl（按 Abs 身份挂
 * WeakMap）丢失 ⇒ 替换产物退化 shape-only fn ⇒ D 路径（impl.relation 的
 * inferFrom / condFallback / throws / fingerprint 等 impl 独有数据）静默
 * 丢失 ⇒ 泛型方法调用经接口 α 代入后折 any/unknown（Bug 810 的引擎面半边；
 * 收割面半边 = harvest-dts 的 α 作用域隔离，见 harvester 的
 * harvest-bug-810-method-type-param-shadow.test.ts）。
 *
 * 口径（见 hof.ts `substFnImpl`）：行为面（apply/body/闭包）与标量 facet
 * α 无关 ⇒ 原样搬运；relation 槽是 Abs 数据 ⇒ 按 map 替换并与 shape 槽
 * 保持同引用（relationFn 双写纪律）。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  attachFnImpl,
  formatShape,
  getFnImpl,
  instantiateReturn,
  isRelFn,
  num,
  relationFn,
  shapeOnlyFn,
  str,
  substAbs,
  v,
  type Abs,
} from "../index.ts";

/** 自由 α（收割面的方法作用域 α 同款形态：裸 var 名） */
const tVar = (): Abs => abs({ k: "any" }, v("T"), undefined, "path");
const eVar = (): Abs => abs({ k: "any" }, v("E"), undefined, "path");
const arrOf = (el: Abs): Abs => abs({ k: "arr", element: el }, undefined, undefined, "exact");

/** Bug 810 场景的方法签名：first<T>(x: T): T extends (infer E)[] ? E : string */
function condMethod(): Abs {
  return relationFn([tVar()], eVar(), {
    params: ["x"],
    inferFrom: { fromVar: "T", via: "arr", inferVar: "E" },
    condFallback: str(),
  });
}

describe("A7 / Bug 810 引擎面 —— substAbs 搬运 fn impl 侧表", () => {
  it("泛型方法经 α 代入后 impl 存活（改前丢 ⇒ D 路径退化）", () => {
    const m = condMethod();
    expect(getFnImpl(m)).toBeDefined();
    // 模拟接口 α 代入（map 命中无关 α 也走 fn 分支重建路径）
    const subbed = substAbs(m, new Map([["W", num()]]));
    expect(getFnImpl(subbed)).toBeDefined();
    expect(getFnImpl(subbed)?.relation?.inferFrom).toEqual({
      fromVar: "T",
      via: "arr",
      inferVar: "E",
    });
  });

  it("inferFrom/condFallback 方法：代入前后调用结论一致（改前折 any）", () => {
    const m = condMethod();
    const subbed = substAbs(m, new Map([["W", num()]]));
    // T=number[] ⇒ infer E=number
    expect(formatShape(instantiateReturn(m, [arrOf(num())]))).toBe("number");
    expect(formatShape(instantiateReturn(subbed, [arrOf(num())]))).toBe("number");
    // T=string（非数组）⇒ condFallback 支
    expect(formatShape(instantiateReturn(m, [str()]))).toBe("string");
    expect(formatShape(instantiateReturn(subbed, [str()]))).toBe("string");
  });

  it("relation 槽按 map 替换，且与 shape 槽保持同引用（双写纪律）", () => {
    const m = relationFn([tVar()], tVar(), { params: ["x"] });
    const subbed = substAbs(m, new Map([["T", str()]]));
    const shape = subbed.shape as Extract<typeof subbed.shape, { k: "fn" }>;
    const rel = getFnImpl(subbed)?.relation;
    expect(rel).toBeDefined();
    expect(rel!.paramTypes).toBe(shape.paramTypes);
    expect(rel!.returnType).toBe(shape.returnType);
    expect(formatShape(rel!.returnType)).toBe("string");
    expect(formatShape(instantiateReturn(subbed, [str()]))).toBe("string");
  });

  it("impl 独有槽（condFallback/throws）也按 map 替换", () => {
    const m = relationFn([tVar()], tVar(), {
      params: ["x"],
      condFallback: tVar(),
    });
    const rel0 = getFnImpl(m)!.relation!;
    expect((rel0.condFallback!.term as { id: string }).id).toBe("T");
    const subbed = substAbs(m, new Map([["T", str()]]));
    const rel = getFnImpl(subbed)!.relation!;
    expect(formatShape(rel.condFallback!)).toBe("string");
  });

  it("标量 facet 原样搬运（fingerprint / params / optionalParams）", () => {
    const m = relationFn([tVar()], tVar(), {
      params: ["x", "y?"],
      fingerprint: "sig-under-test",
    });
    const impl0 = getFnImpl(m)!;
    const subbed = substAbs(m, new Map([["T", str()]]));
    const impl = getFnImpl(subbed)!;
    expect(impl.fingerprint).toBe(impl0.fingerprint);
    expect(impl.params).toEqual(impl0.params);
  });

  it("apply 行为面 α 无关：原样搬运", () => {
    const fn: Abs = abs(
      {
        k: "fn",
        params: ["x"],
        paramTypes: [tVar()],
        returnType: tVar(),
      },
      undefined,
      undefined,
      "path",
    );
    let called = 0;
    attachFnImpl(fn, {
      params: ["x"],
      apply: () => {
        called++;
        return str();
      },
    });
    const subbed = substAbs(fn, new Map([["T", num()]]));
    const impl = getFnImpl(subbed);
    expect(impl?.apply).toBeTypeOf("function");
    // apply 闭包语义保留：新对象调用走同一实现
    const host = (impl!.apply as (a: Abs[]) => Abs)([]);
    expect(called).toBe(1);
    expect(formatShape(host)).toBe("string");
  });

  it("整 Abs 替换路径：替换值是带 impl 的 fn ⇒ 不退化 shape-only", () => {
    const fnVal = relationFn([str()], str(), { params: ["s"] });
    const holder: Abs = abs(
      {
        k: "obj",
        slots: Object.defineProperty({}, "f", {
          value: { value: tVar() },
          enumerable: true,
          writable: true,
          configurable: true,
        }),
      },
      undefined,
      undefined,
      "exact",
    );
    const subbed = substAbs(holder, new Map([["T", fnVal]]));
    const slotF = (subbed.shape as Extract<typeof subbed.shape, { k: "obj" }>).slots["f"]!
      .value;
    expect(getFnImpl(slotF)).toBeDefined();
    expect(formatShape(instantiateReturn(slotF, [str()]))).toBe("string");
  });

  it("shapeOnlyFn（E 路径纪律）：替换后仍不得发明 impl", () => {
    const fn = shapeOnlyFn([tVar()], tVar(), { params: ["x"] });
    const subbed = substAbs(fn, new Map([["T", str()]]));
    expect(getFnImpl(subbed)).toBeUndefined();
    expect(isRelFn(subbed)).toBe(true);
    expect(formatShape(instantiateReturn(subbed, [str()]))).toBe("string");
  });

  it("fn Shape 重建不丢 optionalParams / slots（α 无关 / Abs 值 facet）", () => {
    const fn: Abs = abs(
      {
        k: "fn",
        params: ["x", "y?"],
        optionalParams: [false, true],
        slots: Object.defineProperty({}, "tag", {
          value: { value: tVar() },
          enumerable: true,
          writable: true,
          configurable: true,
        }),
      },
      undefined,
      undefined,
      "path",
    );
    const subbed = substAbs(fn, new Map([["T", str()]]));
    const shape = subbed.shape as Extract<typeof subbed.shape, { k: "fn" }>;
    expect(shape.optionalParams).toEqual([false, true]);
    expect(formatShape(shape.slots!.tag!.value)).toBe("string");
  });

  it("环防御：relation 槽回指本 fn 不死循环，且产物带 impl", () => {
    // fn.returnType = obj{ self: fn }（真环）
    const fnVar = tVar();
    const fn = relationFn([tVar()], fnVar, { params: ["x"] });
    const holder: Abs = abs(
      {
        k: "obj",
        slots: Object.defineProperty({}, "self", {
          value: { value: fn },
          enumerable: true,
          writable: true,
          configurable: true,
        }),
      },
      undefined,
      undefined,
      "exact",
    );
    // fn 的 returnType 指回 holder：fn → returnType(holder) → slot(fn)
    (fn.shape as Extract<typeof fn.shape, { k: "fn" }>).returnType = holder;
    const impl = getFnImpl(fn)!;
    impl.relation!.returnType = holder;
    const subbed = substAbs(fn, new Map([["T", str()]]));
    expect(getFnImpl(subbed)).toBeDefined();
    // 环内回指保持原对象（visiting 口径），外层替换仍发生
    expect(formatShape(subbed)).toContain("…cycle");
  });
});
