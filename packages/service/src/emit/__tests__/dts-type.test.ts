import { describe, it, expect } from "vitest";
import {
  $objAccessor,
  abs,
  anyAbs,
  boolLit,
  joinAbs,
  num,
  numLit,
  str,
  strLit,
  unknown,
  type Abs,
} from "@nudojs/core";
import { createTemplateAbs } from "@nudojs/core/internal";
import { absToTSType } from "../dts-generator.ts";
import { dtsTypeOfAbs, renderDtsType } from "../dts-type.ts";

const ir = (a: Abs): string => {
  const t = dtsTypeOfAbs(a);
  expect(t, `unsupported by dts-type: ${a.shape.k}`).toBeDefined();
  return renderDtsType(t!);
};

const mk = (shape: Abs["shape"]): Abs => abs(shape, undefined, undefined, "exact");
const nullLit = (): Abs => abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
const undefLit = (): Abs =>
  abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");

describe("dts 类型 IR 与 absToTSType 逐字同形（支持子集）", () => {
  it("基础 prim / never / unknown / any", () => {
    for (const a of [num(), str(), unknown, mk({ k: "never" }), anyAbs]) {
      expect(ir(a)).toBe(absToTSType(a));
    }
  });

  it("字面量：字符串 / 数字 / 布尔 / null / undefined / 非有限数", () => {
    for (const a of [
      numLit(1),
      numLit(1.5),
      numLit(Number.POSITIVE_INFINITY),
      strLit("a"),
      boolLit(true),
      nullLit(),
      undefLit(),
    ]) {
      expect(ir(a)).toBe(absToTSType(a));
    }
  });

  it("数组：prim / union 元素", () => {
    for (const a of [
      mk({ k: "arr", element: num() }),
      mk({ k: "arr", element: joinAbs(num(), str()) }),
    ]) {
      expect(ir(a)).toBe(absToTSType(a));
    }
  });

  it("元组：位置 / 洞 / rest", () => {
    const tuple = abs({ k: "tuple", elements: [numLit(1), str()] }, undefined, undefined, "exact");
    expect(ir(tuple)).toBe(absToTSType(tuple));

    const withHole = abs(
      { k: "tuple", elements: [numLit(1), undefLit()], holes: [1] },
      undefined,
      undefined,
      "exact",
    );
    expect(ir(withHole)).toBe(absToTSType(withHole));

    const withRest = abs(
      {
        k: "tuple",
        elements: [num()],
        rest: mk({ k: "arr", element: num() }),
      },
      undefined,
      undefined,
      "exact",
    );
    expect(ir(withRest)).toBe(absToTSType(withRest));
  });

  it("对象：简单槽 / 可选 / 只读 / 空对象", () => {
    const simple = mk({
      k: "obj",
      slots: {
        a: { value: num() },
        b: { value: str(), optional: true },
        c: { value: numLit(1), readonly: true },
      },
    });
    expect(ir(simple)).toBe(absToTSType(simple));

    const empty = mk({ k: "obj", slots: {} });
    expect(ir(empty)).toBe("Record<string, never>");

    const open = mk({ k: "obj", slots: {}, open: true });
    expect(ir(open)).toBe("Record<string, unknown>");

    const openWithSlots = mk({
      k: "obj",
      slots: { a: { value: num() } },
      open: true,
    } as never);
    expect(ir(openWithSlots)).toBe(absToTSType(openWithSlots));
  });

  it("契约字面量槽：eq(self, lit) → 字面量类型", () => {
    const self = { op: "var", id: "x" } as never;
    const slot = abs(
      { k: "prim", type: "string" },
      self,
      { op: "eq", a: self, b: { op: "lit", value: "n" } } as never,
      "path",
    );
    const obj = mk({ k: "obj", slots: { k: { value: slot } } } as never);
    expect(ir(obj)).toBe(absToTSType(obj));
  });

  it("索引签名 / 纯数组视图 / 模板字面量", () => {
    const indexed = mk({
      k: "obj",
      slots: { a: { value: num() } },
      index: { key: str(), value: num() },
    } as never);
    expect(ir(indexed)).toBe(absToTSType(indexed));

    const indexedEmpty = mk({
      k: "obj",
      slots: {},
      index: { key: str(), value: num() },
    } as never);
    expect(ir(indexedEmpty)).toBe(absToTSType(indexedEmpty));

    const view = mk({
      k: "obj",
      slots: {
        "0": { value: numLit(1) },
        "1": { value: str() },
        length: { value: numLit(2) },
      },
      view: "array",
    } as never);
    expect(ir(view)).toBe(absToTSType(view));

    const tpl = createTemplateAbs([strLit("id-"), num()]);
    expect(ir(tpl)).toBe(absToTSType(tpl));
  });

  it("对象不支持的面：用户符号键 ⇒ undefined", () => {
    expect(
      dtsTypeOfAbs(
        mk({ k: "obj", slots: { "@@sym#1": { value: num(), symbolKey: true } } } as never),
      ),
    ).toBeUndefined();
  });

  it("生成器 / 迭代器协议对象", () => {
    const nextFn = mk({ k: "fn", params: [], paramTypes: [] } as never);
    const generator = mk({
      k: "obj",
      slots: {
        next: { value: nextFn },
        return: { value: nextFn },
        "0": { value: numLit(1) },
        "1": { value: numLit(2) },
      },
    } as never);
    expect(ir(generator)).toBe(absToTSType(generator));

    const iterator = mk({
      k: "obj",
      slots: { next: { value: nextFn }, "0": { value: numLit(1) } },
    } as never);
    expect(ir(iterator)).toBe(absToTSType(iterator));

    const asyncGen = mk({
      k: "obj",
      slots: {
        next: { value: nextFn },
        "@@asyncIterator": { value: nextFn, symbolKey: true },
        "0": { value: numLit(1) },
      },
    } as never);
    expect(ir(asyncGen)).toBe(absToTSType(asyncGen));

    const carried = {
      ...mk({
        k: "obj",
        slots: { next: { value: nextFn }, return: { value: nextFn } },
      } as never),
      facets: {
        genElements: [numLit(1)],
        genReturn: str(),
        genNext: boolLit(true),
      },
    } as never;
    expect(ir(carried)).toBe("Generator<number, string, boolean>");
  });

  it("用户符号队列 / internal 槽跳过", () => {
    const symObj = mk({
      k: "obj",
      slots: {
        "@@sym#1": { value: num(), symbolKey: true },
        "@@sym#2": { value: str(), symbolKey: true },
      },
    } as never);
    expect(
      renderDtsType(
        dtsTypeOfAbs(symObj, { userSymbolKeys: ["foo", "bar"] })!,
      ),
    ).toBe("{ [foo]: number; [bar]: string }");

    const privateObj = mk({
      k: "obj",
      slots: {
        "#x": { value: num(), internal: true },
        a: { value: num() },
      },
    } as never);
    expect(ir(privateObj)).toBe(absToTSType(privateObj));
  });

  it("联合：去重 / 丢弃 never", () => {
    const union = joinAbs(joinAbs(num(), str()), mk({ k: "never" }));
    expect(ir(union)).toBe(absToTSType(union));
  });

  it("brand：内建泛型 / Arguments 别名；用户类回落", () => {
    for (const name of ["Map", "Set", "Array", "Promise", "Generator"]) {
      const a = mk({ k: "brand", name, shape: mk({ k: "obj", slots: {} }) } as never);
      expect(ir(a)).toBe(absToTSType(a));
    }
    const args = mk({
      k: "brand",
      name: "Arguments",
      shape: mk({ k: "obj", slots: {} }),
    } as never);
    expect(ir(args)).toBe("IArguments");
    const myClass = mk({
      k: "brand",
      name: "MyClass",
      shape: mk({ k: "obj", slots: {} }),
    } as never);
    // 纯投影（无模块面）保持类名原样。
    expect(ir(myClass)).toBe("MyClass");
    const scope = {
      names: new Set(["MyClass"]),
      requiredArgFillers: new Map<string, readonly string[]>([["MyClass", ["unknown"]]]),
    };
    expect(
      renderDtsType(dtsTypeOfAbs(myClass, { brandScope: scope })!),
    ).toBe("MyClass<unknown>");
    expect(
      renderDtsType(
        dtsTypeOfAbs(myClass, {
          brandScope: { names: new Set(), requiredArgFillers: new Map() },
          runtimeGlobalCtor: (n) => n === "MyClass",
        })!,
      ),
    ).toBe("MyClass");
    expect(
      renderDtsType(
        dtsTypeOfAbs(myClass, {
          brandScope: { names: new Set(), requiredArgFillers: new Map() },
          runtimeGlobalCtor: () => false,
        })!,
      ),
    ).toBe("unknown");
  });

  it("fn：简单签名 / 可选 / rest / 数组与联合中的括号", () => {
    const simple = mk({
      k: "fn",
      params: ["x"],
      paramTypes: [num()],
      returnType: str(),
    } as never);
    expect(ir(simple)).toBe(absToTSType(simple));

    const optional = mk({
      k: "fn",
      params: ["x?"],
      paramTypes: [num()],
      returnType: str(),
    } as never);
    expect(ir(optional)).toBe(absToTSType(optional));

    const restArr = mk({
      k: "fn",
      params: ["...xs"],
      paramTypes: [mk({ k: "arr", element: num() })],
      returnType: str(),
    } as never);
    expect(ir(restArr)).toBe(absToTSType(restArr));

    const restPrim = mk({
      k: "fn",
      params: ["...xs"],
      paramTypes: [num()],
      returnType: str(),
    } as never);
    expect(ir(restPrim)).toBe(absToTSType(restPrim));

    const arrOfFn = mk({ k: "arr", element: simple });
    expect(ir(arrOfFn)).toBe(absToTSType(arrOfFn));
    expect(ir(joinAbs(simple, num()))).toBe(absToTSType(joinAbs(simple, num())));
  });

  it("fn：重载集发调用签名对象", () => {
    const fn = mk({
      k: "fn",
      params: ["x"],
      paramTypes: [num()],
      returnType: str(),
      overloads: [
        { paramTypes: [num()], returnType: str() },
        { paramTypes: [str()], returnType: num() },
      ],
    } as never);
    expect(ir(fn)).toBe(absToTSType(fn));
  });

  it("effect：promise 包装 / 非 promise 透明", () => {
    const promise = mk({ k: "eff", eff: "promise", inner: num() } as never);
    expect(ir(promise)).toBe(absToTSType(promise));
    const thunk = mk({ k: "eff", eff: "unknown", inner: str() } as never);
    expect(ir(thunk)).toBe(absToTSType(thunk));
  });

  it("符号成员 / 访问器 / 数组视图伴生槽 / contract or", () => {
    const iterFn = mk({
      k: "fn",
      params: [],
      paramTypes: [],
      returnType: num(),
    } as never);
    const symObj = mk({
      k: "obj",
      slots: {
        "@@iterator": { value: iterFn, symbolKey: true },
        "@@toStringTag": { value: str(), symbolKey: true },
      },
    } as never);
    expect(ir(symObj)).toBe(absToTSType(symObj));

    const placeholder = abs(
      { k: "unknown" },
      { op: "lit", value: undefined },
      undefined,
      "exact",
    );
    const accObj = $objAccessor(
      mk({ k: "obj", slots: { x: { value: placeholder } } } as never),
      "x",
      () => num(),
      null,
    );
    expect(ir(accObj)).toBe(absToTSType(accObj));

    const view = mk({
      k: "obj",
      slots: {
        "0": { value: numLit(1) },
        length: { value: numLit(1) },
        index: { value: numLit(0) },
      },
      view: "array",
    } as never);
    expect(ir(view)).toBe(absToTSType(view));

    const self = { op: "var", id: "x" } as never;
    const orSlot = abs(
      { k: "prim", type: "string" },
      self,
      {
        op: "or",
        args: [
          { op: "eq", a: self, b: { op: "lit", value: "a" } },
          { op: "eq", a: self, b: { op: "lit", value: "b" } },
        ],
      } as never,
      "path",
    );
    const orObj = mk({ k: "obj", slots: { k: { value: orSlot } } } as never);
    expect(ir(orObj)).toBe(absToTSType(orObj));
  });

  it("类型变量映射 / 对象方法返回注解 / symbol 返回注解", () => {
    const varAbs = abs({ k: "any" }, { op: "var", id: "T" }, undefined, "path");
    const tv = new Map([["T", "string"]]);
    expect(renderDtsType(dtsTypeOfAbs(varAbs, { typeVars: tv })!)).toBe("string");
    const arrVar = mk({ k: "arr", element: varAbs });
    expect(renderDtsType(dtsTypeOfAbs(arrVar, { typeVars: tv })!)).toBe("string[]");

    const fnSlot = mk({
      k: "fn",
      params: ["x"],
      paramTypes: [num()],
      returnType: str(),
    } as never);
    const obj = mk({ k: "obj", slots: { f: { value: fnSlot } } } as never);
    expect(ir(obj)).toBe(absToTSType(obj));
    expect(
      renderDtsType(
        dtsTypeOfAbs(obj, { objectFnReturnOverrides: new Map([["f", "string"]]) })!,
      ),
    ).toBe("{ f: (x: number) => string }");

    const symFn = mk({ k: "fn", params: [], paramTypes: [] } as never);
    const symObj = mk({
      k: "obj",
      slots: { "@@iterator": { value: symFn, symbolKey: true } },
    } as never);
    expect(
      renderDtsType(
        dtsTypeOfAbs(symObj, { symbolReturnOverrides: new Map([["@@iterator", "number"]]) })!,
      ),
    ).toBe("{ [Symbol.iterator](): number }");
  });

  it("不支持：类型变量 ⇒ undefined（回落旧渲染器）", () => {
    expect(
      dtsTypeOfAbs(abs({ k: "any" }, { op: "var", id: "T" }, undefined, "path")),
    ).toBeUndefined();
  });

  it("readonly 元组由模型标记打印", () => {
    const tuple = abs({ k: "tuple", elements: [numLit(1)] }, undefined, undefined, "exact");
    const t = dtsTypeOfAbs(tuple, { readonlyValues: true });
    expect(t).toBeDefined();
    expect(renderDtsType(t!)).toBe("readonly [1]");
  });
});
