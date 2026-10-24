/**
 * Bug 1097 —— `tupleElementDomain`（`packages/core/src/algebra/hof.ts`）按
 * **形状 kind** 判「元素域是否可知」：`shape.k === "unknown"` ⇒ 域退 `any`。
 *
 * 但引擎把 `null` / `undefined` 建成「`unknown` **形状** + lit **项**」
 * （`abs.ts` 的 `absLit`：`abs({k:"unknown"}, lit(null), …)`；`exec` runtime
 * 的 `undef()` 同款）⇒ 这两个是**已知类型**，却被当成「域不可知」⇒
 * 元素域整体退 `any`：
 *
 * - `[null]` / `[undefined]`：元素域从 `null` / `undefined` 退成 `any`
 *   （精度回退）；
 * - `[1,null]`：退成 `any`（应为 `number | null`）；
 * - `any` 是「**自信的任意值**」（仓内口径 `abs.ts`：`any` = 无约束并集，
 *   `unknown` = 推导失败）⇒ 参与算术即抽象强转 ⇒ 记 may-throw ⇒ L2 假红。
 *
 * 修法：元素分三类——已知 nullish（**不参与**异型判定，只**贡献可空性**）／
 * 真·推断失败（退 **`unknown`**，不是 `any`）／其它（既有同型 base type 口径，
 * 异型仍退 `any`）。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  formatShape,
  instantiateReturn,
  lit,
  numLit,
  strLit,
  unknown,
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

/** 引擎的 `null` 值：unknown 形状 + lit 项（`abs.ts` 的 `absLit`） */
function nullElem(): Abs {
  return abs({ k: "unknown" }, lit(null), undefined, "exact");
}

/** 引擎的 `undefined` 值：unknown 形状 + lit 项 */
function undefElem(): Abs {
  return abs({ k: "unknown" }, lit(undefined), undefined, "exact");
}

/** tuple 实参的元素域（经 α 绑定后的返回类型） */
function elementDomain(...elements: Abs[]): Abs {
  return instantiateReturn(genericArrFn(), [tupleArg(...elements)]);
}

describe("Bug 1097: tuple 元素域的 7 个验收值", () => {
  it("[1,2] ⇒ number（同型 base prim，字面量拓宽）", () => {
    const d = elementDomain(numLit(1), numLit(2));
    expect(d.shape).toEqual({ k: "prim", type: "number" });
    expect(formatShape(d)).toBe("number");
  });

  it("[1,null] ⇒ number | null（nullish 只贡献可空性，不判异型）", () => {
    const d = elementDomain(numLit(1), nullElem());
    expect(formatShape(d)).toBe("number | null");
    expect(d.shape.k).toBe("sum");
  });

  it("[1,undefined] ⇒ number | undefined", () => {
    const d = elementDomain(numLit(1), undefElem());
    expect(formatShape(d)).toBe("number | undefined");
    expect(d.shape.k).toBe("sum");
  });

  it("[null] ⇒ null（已知类型，不是 any）", () => {
    const d = elementDomain(nullElem());
    expect(formatShape(d)).toBe("null");
    expect(d.shape.k).not.toBe("any");
    expect(d.term?.op === "lit" && d.term.value === null).toBe(true);
  });

  it("[undefined] ⇒ undefined（已知类型，不是 any）", () => {
    const d = elementDomain(undefElem());
    expect(formatShape(d)).toBe("undefined");
    expect(d.shape.k).not.toBe("any");
    expect(d.term?.op === "lit" && d.term.value === undefined).toBe(true);
  });

  it("[1,\"a\"] ⇒ any（异型：既有保守口径，本轮不变）", () => {
    const d = elementDomain(numLit(1), strLit("a"));
    expect(d.shape.k).toBe("any");
    expect(formatShape(d)).toBe("any");
  });

  it("真·未知元素（unknown 形状且无已知 lit）⇒ unknown（推导失败，不是 any）", () => {
    const d = elementDomain(unknown);
    expect(d.shape.k).toBe("unknown");
    expect(formatShape(d)).toBe("unknown");
  });
});

describe("Bug 1097: 修前红 / 修后绿（口径锚点）", () => {
  it("修前：nullish 元素命中 `shape.k === \"unknown\"` 一刀切 ⇒ 域退 any", () => {
    // 修前实现（保留为对照）：任何 unknown 形状元素 ⇒ anyAbs。
    const oldDomain = (elements: Abs[]): Abs => {
      for (const el of elements) {
        if (el.shape.k === "any" || el.shape.k === "unknown") {
          return abs({ k: "any" }, undefined, undefined, "path");
        }
      }
      return elements[0]!;
    };
    expect(formatShape(oldDomain([nullElem()]))).toBe("any");
    expect(formatShape(oldDomain([numLit(1), nullElem()]))).toBe("any");
  });

  it("修后：同一输入不再退 any（null / number | null）", () => {
    expect(formatShape(elementDomain(nullElem()))).toBe("null");
    expect(formatShape(elementDomain(numLit(1), nullElem()))).toBe("number | null");
  });

  it("仓内口径：unknown = 推导失败，any = 无约束并集（二者不可互换）", () => {
    expect(unknown.shape.k).toBe("unknown");
    expect(abs({ k: "any" }, undefined, undefined, "path").shape.k).toBe("any");
  });
});

describe("Bug 1097: 其它 nullish 组合", () => {
  it("[null, undefined] ⇒ null | undefined（两个已知 nullish 都保留）", () => {
    const d = elementDomain(nullElem(), undefElem());
    expect(formatShape(d)).toBe("null | undefined");
  });

  it("[1, null, null] ⇒ number | null（重复 nullish 去重）", () => {
    const d = elementDomain(numLit(1), nullElem(), nullElem());
    expect(formatShape(d)).toBe("number | null");
  });

  it("[null, 1] ⇒ number | null（nullish 位置不影响结果）", () => {
    const d = elementDomain(nullElem(), numLit(1));
    expect(formatShape(d)).toBe("number | null");
  });

  it("[1, null, \"a\"] ⇒ any（异型优先：仍不窄化成联合）", () => {
    const d = elementDomain(numLit(1), nullElem(), strLit("a"));
    expect(d.shape.k).toBe("any");
  });

  it("[null, 真·未知] ⇒ unknown（真·推断失败优先于可空性）", () => {
    const d = elementDomain(nullElem(), unknown);
    expect(d.shape.k).toBe("unknown");
  });
});
