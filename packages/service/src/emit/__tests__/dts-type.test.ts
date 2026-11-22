import { describe, it, expect } from "vitest";
import {
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
  });

  it("对象不支持的面：view / index / symbol / internal / fn 槽 ⇒ undefined", () => {
    expect(
      dtsTypeOfAbs(mk({ k: "obj", slots: {}, view: "array" } as never)),
    ).toBeUndefined();
    expect(
      dtsTypeOfAbs(
        mk({ k: "obj", slots: {}, index: { key: str(), value: num() } } as never),
      ),
    ).toBeUndefined();
    expect(
      dtsTypeOfAbs(
        mk({ k: "obj", slots: { "@@iterator": { value: num(), symbolKey: true } } } as never),
      ),
    ).toBeUndefined();
    expect(
      dtsTypeOfAbs(
        mk({ k: "obj", slots: { f: { value: mk({ k: "fn" } as never) } } } as never),
      ),
    ).toBeUndefined();
  });

  it("联合：去重 / 丢弃 never", () => {
    const union = joinAbs(joinAbs(num(), str()), mk({ k: "never" }));
    expect(ir(union)).toBe(absToTSType(union));
  });

  it("effect：promise 包装 / 非 promise 透明", () => {
    const promise = mk({ k: "eff", eff: "promise", inner: num() } as never);
    expect(ir(promise)).toBe(absToTSType(promise));
    const thunk = mk({ k: "eff", eff: "unknown", inner: str() } as never);
    expect(ir(thunk)).toBe(absToTSType(thunk));
  });

  it("不支持：brand / fn / 类型变量 ⇒ undefined（回落旧渲染器）", () => {
    expect(
      dtsTypeOfAbs(mk({ k: "brand", name: "Date", shape: mk({ k: "obj", slots: {} }) } as never)),
    ).toBeUndefined();
    expect(dtsTypeOfAbs(mk({ k: "fn" } as never))).toBeUndefined();
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
