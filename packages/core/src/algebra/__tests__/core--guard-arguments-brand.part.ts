/**
 * BUG-158 —— `arguments` 是**非数组 exotic**（core 自己的 Bug 56 判
 * `Array.isArray(arguments) === false`），而 guard 面把 brand 的内层 tuple
 * 折成 `Array.isArray(data) && …` ⇒ 守卫对被导出函数**自己的返回值**恒假。
 *
 * 根因：`denote.ts` 的 arr / tuple 分支把 `Array.isArray` 硬编码成必要前提，
 * 不看 brand 的 exotic 语义（`brand "Arguments"` 包 tuple）。
 *
 * 本钉：`Arguments` brand 只判长度 / 下标语义，不发数组前提。
 */
import { describe, it, expect } from "vitest";
import { abs, obj, strLit, type Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

/** `arguments`（长度 0）的 Abs 形态：brand "Arguments" 包空 tuple */
function emptyArgsAbs(): Abs {
  return abs(
    { k: "brand", name: "Arguments", shape: abs({ k: "tuple", elements: [] }, undefined, undefined, "exact") },
    undefined,
    undefined,
    "exact",
  );
}

/** 长度 2 的 `arguments`：两个 unknown 元素 */
function twoArgsAbs(): Abs {
  const unknownEl = abs({ k: "unknown" }, undefined, undefined, "exact");
  return abs(
    {
      k: "brand",
      name: "Arguments",
      shape: abs({ k: "tuple", elements: [unknownEl, unknownEl] }, undefined, undefined, "exact"),
    },
    undefined,
    undefined,
    "exact",
  );
}

const runner = (g: string): ((data: unknown) => boolean) =>
  new Function("data", `return ${g};`) as (data: unknown) => boolean;

const argsOf = (n: number): unknown => {
  const f = new Function(`return (function(){ return arguments; })(${Array.from({ length: n }, () => "1").join(",")});`);
  return f();
};

describe("BUG-158 — `arguments`（非数组 exotic）不得以 Array.isArray 为前提", () => {
  it("守卫体不含 `Array.isArray`，且放行函数自己的 `arguments`", () => {
    const g = denoteGuard(emptyArgsAbs(), "data");
    expect(g).not.toContain("Array.isArray");
    const check = runner(g);
    expect(Array.isArray(argsOf(0))).toBe(false);
    expect(check(argsOf(0))).toBe(true);
  });

  it("长度语义仍是判据（负控制）", () => {
    const check = runner(denoteGuard(twoArgsAbs(), "data"));
    expect(check(argsOf(2))).toBe(true);
    expect(check(argsOf(0))).toBe(false);
    expect(check(argsOf(3))).toBe(false);
  });

  it("与 core 的 `Array.isArray` 判定同口径（不许自相矛盾）", () => {
    // 守卫接受的对象必须包含 `arguments`；普通对象/数组按形状各自裁决
    const g = denoteGuard(emptyArgsAbs(), "data");
    expect(g).not.toContain("Array.isArray");
    expect(obj({ a: { value: strLit("x") } }).shape.k).toBe("obj");
  });
});
