import { describe, it, expect } from "vitest";
import { abs as makeAbs, num, str, bool, numLit, strLit, never, unknown, gt, lit, v as termVar } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

describe("denoteGuard", () => {
  it("prim number", () => {
    expect(denoteGuard(num(), "x")).toBe('typeof x === "number"');
  });

  it("literal number keeps exact equality", () => {
    expect(denoteGuard(numLit(8), "x")).toBe("x === 8");
  });

  it("literal string", () => {
    expect(denoteGuard(strLit("hi"), "x")).toBe('x === "hi"');
  });

  it("NaN / ±Infinity literals render valid guards, not === null", () => {
    expect(denoteGuard(numLit(NaN), "x")).toBe("Number.isNaN(x)");
    expect(denoteGuard(numLit(Infinity), "x")).toBe("x === Infinity");
    expect(denoteGuard(numLit(-Infinity), "x")).toBe("x === -Infinity");
  });

  it("object structure", () => {
    const o = makeAbs(
      { k: "obj", slots: { id: { value: num() }, name: { value: str() } } },
      undefined,
      undefined,
      "exact",
    );
    const g = denoteGuard(o, "o");
    expect(g).toContain('typeof o === "object"');
    expect(g).toContain('typeof o.id === "number"');
    expect(g).toContain('typeof o.name === "string"');
  });

  it("array element", () => {
    const a = makeAbs({ k: "arr", element: num() }, undefined, undefined, "exact");
    const g = denoteGuard(a, "a");
    expect(g).toContain("Array.isArray(a)");
    expect(g).toContain('typeof item === "number"');
  });

  it("sum is union of members", () => {
    const s = makeAbs(
      { k: "sum", members: [numLit(1), numLit(2)] },
      undefined,
      undefined,
      "exact",
    );
    expect(denoteGuard(s, "x")).toBe("(x === 1 || x === 2)");
  });

  it("numeric pred: term > 0 on value", () => {
    const a = makeAbs(
      { k: "prim", type: "number" },
      termVar("x"),
      gt(termVar("x"), lit(0)),
      "path",
    );
    const g = denoteGuard(a, "data");
    expect(g).toContain('typeof data === "number"');
    expect(g).toContain("data > 0");
  });

  it("never / unknown / bool", () => {
    expect(denoteGuard(never, "x")).toBe("false");
    expect(denoteGuard(unknown, "x")).toBe("true");
    expect(denoteGuard(bool(), "x")).toBe('typeof x === "boolean"');
  });

  it("lit(undefined) / lit(null) generate equality guards (BUG-003)", () => {
    // litValue 哨兵把 lit(undefined) 折成「无字面量」，旧实现恒真
    const undefLit = makeAbs({ k: "unknown" }, lit(undefined), undefined, "exact");
    const nullLit = makeAbs({ k: "unknown" }, lit(null), undefined, "exact");
    expect(denoteGuard(undefLit, "data")).toBe("data === undefined");
    expect(denoteGuard(nullLit, "data")).toBe("data === null");
  });

  it("null|undefined union guard is not constantly true (BUG-003)", () => {
    const nullLit = makeAbs({ k: "unknown" }, lit(null), undefined, "exact");
    const undefLit = makeAbs({ k: "unknown" }, lit(undefined), undefined, "exact");
    const s = makeAbs({ k: "sum", members: [nullLit, undefLit] }, undefined, undefined, "exact");
    expect(denoteGuard(s, "data")).toBe("(data === null || data === undefined)");
  });

  it("object required undefined field is checked (BUG-003)", () => {
    const undefLit = makeAbs({ k: "unknown" }, lit(undefined), undefined, "exact");
    const o = makeAbs(
      { k: "obj", slots: { x: { value: undefLit }, y: { value: numLit(1) } } },
      undefined,
      undefined,
      "exact",
    );
    const g = denoteGuard(o, "data");
    expect(g).toContain("data.x === undefined");
    expect(g).toContain("data.y === 1");
  });

  it("tuple hole slot guards with `!(i in v)`, not v[i]===undefined (BUG-020/I1)", () => {
    const undefLit = makeAbs({ k: "unknown" }, lit(undefined), undefined, "exact");
    // [1, , 3]：index 1 是 hole（下标缺席），与 [1, undefined, 3] 可观察不同
    const sparse = makeAbs(
      { k: "tuple", elements: [numLit(1), undefLit, numLit(3)], holes: [1] },
      undefined,
      undefined,
      "exact",
    );
    const g = denoteGuard(sparse, "a");
    expect(g).toContain("!(1 in a)");
    // hole 槽不得再检读值 undefined（那会把显式 undefined 元素也放行）
    expect(g).not.toContain("a[1] === undefined");
    expect(g).toContain("a[0] === 1");
    expect(g).toContain("a[2] === 3");

    // 运行时：稀疏位通过、显式 undefined 位失败
    const check = new Function("a", `return ${g};`);
    expect(check([1, , 3])).toBe(true);
    expect(check([1, undefined, 3])).toBe(false);
  });

  it("leading/multi tuple holes each guard `!(i in v)` (BUG-020/I1)", () => {
    const undefLit = makeAbs({ k: "unknown" }, lit(undefined), undefined, "exact");
    const leading = makeAbs(
      { k: "tuple", elements: [undefLit, numLit(1)], holes: [0] },
      undefined,
      undefined,
      "exact",
    );
    const g0 = denoteGuard(leading, "a");
    expect(g0).toContain("!(0 in a)");
    expect(g0).not.toContain("a[0] === undefined");

    const multi = makeAbs(
      { k: "tuple", elements: [undefLit, numLit(1), undefLit], holes: [0, 2] },
      undefined,
      undefined,
      "exact",
    );
    const g2 = denoteGuard(multi, "a");
    expect(g2).toContain("!(0 in a)");
    expect(g2).toContain("!(2 in a)");
    const check2 = new Function("a", `return ${g2};`);
    expect(check2([, 1, ,])).toBe(true);
    expect(check2([undefined, 1, undefined])).toBe(false);
  });
});
