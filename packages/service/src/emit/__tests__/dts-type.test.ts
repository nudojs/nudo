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

describe("dts 类型 IR 快照", () => {
  it("基础 prim / never / unknown / any", () => {
    for (const a of [num(), str(), unknown, mk({ k: "never" }), anyAbs]) {
      expect(ir(a)).toMatchSnapshot();
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
      expect(ir(a)).toMatchSnapshot();
    }
  });

  it("数组：prim / union 元素", () => {
    for (const a of [
      mk({ k: "arr", element: num() }),
      mk({ k: "arr", element: joinAbs(num(), str()) }),
    ]) {
      expect(ir(a)).toMatchSnapshot();
    }
  });

  it("元组：位置 / 洞 / rest", () => {
    const tuple = abs({ k: "tuple", elements: [numLit(1), str()] }, undefined, undefined, "exact");
    expect(ir(tuple)).toMatchSnapshot();

    const withHole = abs(
      { k: "tuple", elements: [numLit(1), undefLit()], holes: [1] },
      undefined,
      undefined,
      "exact",
    );
    expect(ir(withHole)).toMatchSnapshot();

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
    expect(ir(withRest)).toMatchSnapshot();
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
    expect(ir(simple)).toMatchSnapshot();

    const empty = mk({ k: "obj", slots: {} });
    expect(ir(empty)).toBe("Record<string, never>");

    const open = mk({ k: "obj", slots: {}, open: true });
    expect(ir(open)).toBe("Record<string, unknown>");

    const openWithSlots = mk({
      k: "obj",
      slots: { a: { value: num() } },
      open: true,
    } as never);
    expect(ir(openWithSlots)).toMatchSnapshot();
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
    expect(ir(obj)).toMatchSnapshot();
  });

  it("索引签名 / 纯数组视图 / 模板字面量", () => {
    const indexed = mk({
      k: "obj",
      slots: { a: { value: num() } },
      index: { key: str(), value: num() },
    } as never);
    expect(ir(indexed)).toMatchSnapshot();

    const indexedEmpty = mk({
      k: "obj",
      slots: {},
      index: { key: str(), value: num() },
    } as never);
    expect(ir(indexedEmpty)).toMatchSnapshot();

    const view = mk({
      k: "obj",
      slots: {
        "0": { value: numLit(1) },
        "1": { value: str() },
        length: { value: numLit(2) },
      },
      view: "array",
    } as never);
    expect(ir(view)).toMatchSnapshot();

    const tpl = createTemplateAbs([strLit("id-"), num()]);
    expect(ir(tpl)).toMatchSnapshot();
  });

  it("无源码名的用户符号键被跳过（与旧渲染器同口径）", () => {
    expect(
      ir(
        mk({ k: "obj", slots: { "@@sym#1": { value: num(), symbolKey: true } } } as never),
      ),
    ).toBe("Record<string, never>");
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
    expect(ir(generator)).toMatchSnapshot();

    const iterator = mk({
      k: "obj",
      slots: { next: { value: nextFn }, "0": { value: numLit(1) } },
    } as never);
    expect(ir(iterator)).toMatchSnapshot();

    const asyncGen = mk({
      k: "obj",
      slots: {
        next: { value: nextFn },
        "@@asyncIterator": { value: nextFn, symbolKey: true },
        "0": { value: numLit(1) },
      },
    } as never);
    expect(ir(asyncGen)).toMatchSnapshot();

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
    expect(ir(privateObj)).toMatchSnapshot();
  });

  it("联合：去重 / 丢弃 never", () => {
    const union = joinAbs(joinAbs(num(), str()), mk({ k: "never" }));
    expect(ir(union)).toMatchSnapshot();
  });

  it("brand：内建泛型 / Arguments 别名；用户类回落", () => {
    for (const name of ["Map", "Set", "Array", "Promise", "Generator"]) {
      const a = mk({ k: "brand", name, shape: mk({ k: "obj", slots: {} }) } as never);
      expect(ir(a)).toMatchSnapshot();
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
    expect(ir(simple)).toMatchSnapshot();

    const optional = mk({
      k: "fn",
      params: ["x?"],
      paramTypes: [num()],
      returnType: str(),
    } as never);
    expect(ir(optional)).toMatchSnapshot();

    const restArr = mk({
      k: "fn",
      params: ["...xs"],
      paramTypes: [mk({ k: "arr", element: num() })],
      returnType: str(),
    } as never);
    expect(ir(restArr)).toMatchSnapshot();

    const restPrim = mk({
      k: "fn",
      params: ["...xs"],
      paramTypes: [num()],
      returnType: str(),
    } as never);
    expect(ir(restPrim)).toMatchSnapshot();

    const arrOfFn = mk({ k: "arr", element: simple });
    expect(ir(arrOfFn)).toMatchSnapshot();
    expect(ir(joinAbs(simple, num()))).toMatchSnapshot();
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
    expect(ir(fn)).toMatchSnapshot();
  });

  it("effect：promise 包装 / 非 promise 透明", () => {
    const promise = mk({ k: "eff", eff: "promise", inner: num() } as never);
    expect(ir(promise)).toMatchSnapshot();
    const thunk = mk({ k: "eff", eff: "unknown", inner: str() } as never);
    expect(ir(thunk)).toMatchSnapshot();
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
    expect(ir(symObj)).toMatchSnapshot();

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
    expect(ir(accObj)).toMatchSnapshot();

    const view = mk({
      k: "obj",
      slots: {
        "0": { value: numLit(1) },
        length: { value: numLit(1) },
        index: { value: numLit(0) },
      },
      view: "array",
    } as never);
    expect(ir(view)).toMatchSnapshot();

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
    expect(ir(orObj)).toMatchSnapshot();
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
    expect(ir(obj)).toMatchSnapshot();
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

  it("未映射类型变量 ⇒ unknown（不再回落）", () => {
    expect(
      ir(abs({ k: "any" }, { op: "var", id: "T" }, undefined, "path")),
    ).toBe("unknown");
  });

  it("readonly 元组由模型标记打印", () => {
    const tuple = abs({ k: "tuple", elements: [numLit(1)] }, undefined, undefined, "exact");
    const t = dtsTypeOfAbs(tuple, { readonlyValues: true });
    expect(t).toBeDefined();
    expect(renderDtsType(t!)).toBe("readonly [1]");
  });
});
