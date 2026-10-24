/**
 * Bug 404 —— `formatShape` 的 **union 成员**不给**函数类型**加括号。
 *
 * 症状（改前）：`sum(fn, number)` 渲染成 `(1) => 1 | 2` ⇒ 按 TS 解析规则，
 * `|` 绑定到**函数的返回类型** ⇒ 「函数或 number」被读成「返回 `1 | 2` 的
 * 函数」。姊妹渲染器 `absToTSType`（dts 面）对同一 Abs 给的是
 * `((a: 1) => 1) | 2` ⇒ **同一个 Abs 两个渲染器两种读法**。
 *
 * 根因：`formatShapeInner` 的 `case "sum"` 把成员文本用 `" | "` 直接拼接、
 * **不做分组**。与 Bug 403 是**同一处缺口**（缺「需要分组」谓词），只是位置
 * 在 `sum` 臂而不是 `arr` 臂 ⇒ 同一处谓词（`needsGrouping`）两处共用。
 *
 * 修法（族 09 · S1）：`case "sum"` 的成员文本在 `needsGrouping` 命中时加括号
 * （**只对 `fn`**；`brand` / `obj` / `tuple` 不在本片范围）；去重 key 仍用
 * **未包裹**的文本（避免把 `fn` 成员与别的成员误去重）。
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "../format.ts";
import { abs, anyAbs, numLit, strLit, type Abs } from "../abs.ts";
import { call } from "./eval-helpers.ts";

/** fn Abs（形参 `a: number`，返回 `number`） */
function fnAbs(): Abs {
  return abs(
    { k: "fn", params: ["a"], paramTypes: [numLit(1)], returnType: numLit(1) },
    undefined,
    undefined,
    "exact",
  );
}

/** fn Abs（形参 `a: number`，返回 `string`） */
function fnStrAbs(): Abs {
  return abs(
    { k: "fn", params: ["a"], paramTypes: [numLit(1)], returnType: strLit("s") },
    undefined,
    undefined,
    "exact",
  );
}

describe("Bug 404 —— formatShape 的 union 成员给函数类型加括号", () => {
  it("sum(fn, number)：函数成员加括号（改前 `(1) => 1 | 2`）", () => {
    const a = abs(
      { k: "sum", members: [fnAbs(), numLit(2)] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("((1) => 1) | 2");
  });

  it("sum(fn, fn)：两个函数成员都加括号", () => {
    const a = abs(
      { k: "sum", members: [fnAbs(), fnStrAbs()] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe('((1) => 1) | ((1) => "s")');
  });

  it("sum(arr(fn), number)：数组成员靠 arr 臂自己加括号（成员本身不是 fn）", () => {
    const arrFn = abs({ k: "arr", element: fnAbs() }, undefined, undefined, "exact");
    const a = abs(
      { k: "sum", members: [arrFn, numLit(2)] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("((1) => 1)[] | 2");
  });

  it("控制：非函数成员的 union 不加括号", () => {
    const a = abs(
      { k: "sum", members: [numLit(1), strLit("x")] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe('1 | "x"');
  });

  it("去重：文本相同的两个 fn 成员只留一条（去重 key 用未包裹文本）", () => {
    const a = abs(
      { k: "sum", members: [fnAbs(), fnAbs()] },
      undefined,
      undefined,
      "exact",
    );
    expect(formatShape(a)).toBe("((1) => 1)");
  });

  it("端到端：真实源码返回「函数或 number」时 `|` 不得被返回类型吃掉", () => {
    // 实参取 any（未约束）⇒ 三元两臂都可达 ⇒ 返回面是 union
    const r = call(
      `export function f(flag) { return flag ? () => 1 : 2; }`,
      "f",
      [anyAbs],
    );
    expect(r.result.shape.k).toBe("sum");
    const text = formatShape(r.result);
    // 改前是 `() => ? | 2`（`|` 绑定到函数的返回类型）
    expect(text).not.toContain("=> ? |");
    expect(text).toMatch(/^\(.+\) \| 2$/);
  });
});
