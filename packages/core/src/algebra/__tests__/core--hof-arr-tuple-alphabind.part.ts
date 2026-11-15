/**
 * Bug 1079 —— arr 形参（收割的 `T[]`）× tuple 实参（引擎的数组字面量）：
 * α 绑定**只取首元素** ⇒ 异构数组 `[1,"a"]` 被推成 `number[]`
 * ——比真实类型 `(number|string)[]` **更窄** ⇒ 把「不知道」升级成「知道」
 * ⇒ 下游按该类型执法时假绿（契约 `array(number())` 被判满足，而实参里
 * 可能有 string）／假红（契约 `array(string())`）。
 *
 * 修法（`packages/core/src/algebra/hof.ts` 的 `tupleElementDomain`）：
 * 元素域 = tuple **全部**元素的同型域；异构 ⇒ `any`（诚实的「不知道」）。
 * 同型时仍绑出元素类型 ⇒ Bug 453 的 L2 假红修复（同 kind 臂 + 跨 kind 臂
 * 都还生效）不被回退。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  anyAbs,
  instantiateReturn,
  numLit,
  strLit,
  type Abs,
} from "../index.ts";

/** α 变量（any 形状 + var term） */
const alpha = abs({ k: "any" }, { op: "var", id: "T0" }, undefined, "exact");
/** harvester 建的 `T[]` 形参：shape = arr(element = α) */
const arrParam = abs({ k: "arr", element: alpha }, undefined, undefined, "exact");

/** 泛型 `<T>(xs: T[]) => T` 的外延关系（收割面：paramTypes + returnType） */
function genericArrFn(): Abs {
  return abs(
    {
      k: "fn",
      params: ["xs"],
      paramTypes: [arrParam],
      returnType: alpha,
    },
    undefined,
    undefined,
    "exact",
  );
}

/** 引擎的数组字面量实参：shape = tuple(elements) */
function tupleArg(...elements: Abs[]): Abs {
  return abs({ k: "tuple", elements }, undefined, undefined, "exact");
}

describe("Bug 1079: arr 形参 × tuple 实参的 α 绑定口径", () => {
  it("异构数组字面量 [1,\"a\"] ⇒ α 不绑成 number（落 any，不窄于真实类型）", () => {
    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(numLit(1), strLit("a"))]);
    // 改前：首元素 ⇒ T := number ⇒ 返回 `number[]`（比真实类型窄 ⇒ 假绿）
    expect(out.shape).not.toEqual({ k: "prim", type: "number" });
    expect(out.shape.k).toBe("any");
  });

  it("异构数组字面量 [1,\"a\"] ⇒ 返回类型不窄于真实类型 `(number|string)[]`", () => {
    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(numLit(1), strLit("a"))]);
    // 真实元素域含 string ⇒ 推出来的类型不得断言「只有 number」
    const shape = out.shape;
    expect(shape.k).not.toBe("prim");
    expect(shape.k).not.toBe("tuple");
  });

  it("异构数组字面量（string 在前）⇒ 同样落 any（首元素不是 number 也不该被当成全域）", () => {
    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(strLit("a"), numLit(1))]);
    expect(out.shape.k).toBe("any");
  });

  it("同型数组字面量 [1,2] ⇒ α 仍绑成 number（Bug 453 的 L2 修复不回退）", () => {
    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(numLit(1), numLit(2))]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  });

  it("同型数组字面量 [1,2] ⇒ 元素域按 TS 侧字面量拓宽落 base prim（不是 1|2 / 不是 1）", () => {
    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(numLit(1), numLit(2))]);
    expect(out.term?.op).not.toBe("lit");
  });

  it("同型数组字面量 [\"a\"] ⇒ α 绑成 string", () => {
    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg(strLit("a"))]);
    expect(out.shape).toEqual({ k: "prim", type: "string" });
  });

  it("空 tuple 实参不绑（无元素 ⇒ 保守留空，不臆造元素类型）", () => {
    const fn = genericArrFn();
    const out = instantiateReturn(fn, [tupleArg()]);
    expect(out.shape.k).toBe("any");
  });

  it("同 kind 臂不受影响：arr 形参 × arr 实参仍绑出元素类型（既有 deep-α 用例护栏）", () => {
    const fn = genericArrFn();
    const arrArg = abs(
      { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    const out = instantiateReturn(fn, [arrArg]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  });

  it("异构 ⇒ α 绑成 any（绑上去而非跳过）：后续形参不得把同一个 α 绑成窄类型", () => {
    // 「首次绑定保留」语义：异构元素域必须**占住** α，否则后续形参（这里
    // 是第二个 `T` 形参）会绑出窄类型 ⇒ 又变回「自信的错误类型」。
    const fn = abs(
      {
        k: "fn",
        params: ["xs", "y"],
        paramTypes: [arrParam, alpha],
        returnType: alpha,
      },
      undefined,
      undefined,
      "exact",
    );
    const out = instantiateReturn(fn, [tupleArg(numLit(1), strLit("a")), numLit(2)]);
    expect(out.shape.k).toBe("any");
  });
});

describe("Bug 1079: anyAbs 是异构元素域的落点", () => {
  it("异构元素域用 anyAbs（不是 unknown——unknown 是推断失败，any 是未约束）", () => {
    const fn = abs(
      {
        k: "fn",
        params: ["xs", "y"],
        paramTypes: [arrParam, alpha],
        returnType: alpha,
      },
      undefined,
      undefined,
      "exact",
    );
    const out = instantiateReturn(fn, [tupleArg(numLit(1), strLit("a")), numLit(2)]);
    // ⚠ 断言强度：落点是 **anyAbs 本体的面**（`anyAbs.shape` 是**同一个**
    // 对象）——旧写法只断言本地常量 `anyAbs.shape.k === "any"`（恒真 ⇒ 在
    // main 上也过 ⇒ 空转）；这里断言的是**引擎行为**：异构元素域真的落到
    // anyAbs（main 的引擎会绑成 number ⇒ 这条断言在 main 上**红**）。
    expect(out.shape).toBe(anyAbs.shape);
    expect(out.shape).toEqual({ k: "any" });
    expect(out.shape.k).not.toBe("unknown");
    expect(out.conf).toBe(anyAbs.conf);
    expect(out.term).toBe(anyAbs.term);

    // 负控制：同型元素域**不是** anyAbs（否则上面那条断言没有鉴别力——
    // 修前 α 绑成首元素 number，落点与 anyAbs 完全不同）
    const homogeneous = instantiateReturn(
      abs(
        { k: "fn", params: ["xs"], paramTypes: [arrParam], returnType: alpha },
        undefined,
        undefined,
        "exact",
      ),
      [tupleArg(numLit(1), numLit(2))],
    );
    expect(homogeneous.shape).not.toBe(anyAbs.shape);
    expect(homogeneous.shape).toEqual({ k: "prim", type: "number" });
  });
});
