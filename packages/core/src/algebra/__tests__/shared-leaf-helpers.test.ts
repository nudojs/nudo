/**
 * 共享叶子助手钉（`scan/path-projection.ts` / `exec/runtime/proto-walk.ts`）。
 *
 * 两处此前是重复实现：
 * - `check-case-scan.ts` 的 `projectCaseArgField` 与 `scan/literal-shapes.ts`
 *   的 `projectArgPath` 逐字相同 ⇒ 现共用 `projectAbsPath`；
 * - `array-length.ts` 与 `proto-set.ts` 各有一份 `MAX_PROTO_DEPTH` +
 *   `ownPropHolder` ⇒ 现共用 `proto-walk.ts`（链解析**不**共享：两处不同）。
 *
 * 本测试钉住共享部分的语义（brand 拆壳 / 缺槽 / 非 obj / 无自有槽形态）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, strLit } from "../abs.ts";
import { objOf } from "../objects.ts";
import { projectAbsPath } from "../scan/path-projection.ts";
import { ownPropHolder } from "../exec/runtime/proto-walk.ts";

describe("projectAbsPath：契约路径投影", () => {
  it("嵌套点路径逐段下钻（返回槽值对象本身）", () => {
    const grade = numLit(3);
    const root = objOf({ card: { value: objOf({ grade: { value: grade } }) } });
    expect(projectAbsPath(root, ["card", "grade"])).toBe(grade);
  });

  it("brand 先拆壳（顶段 / 嵌套段均生效）", () => {
    const x = strLit("s");
    const inner = objOf({ x: { value: x } });
    const brand = abs({ k: "brand", name: "Box", shape: inner }, undefined, undefined, "exact");
    expect(projectAbsPath(brand, ["x"])).toBe(x);
    const root = objOf({ box: { value: brand } });
    expect(projectAbsPath(root, ["box", "x"])).toBe(x);
  });

  it("缺槽 / 非 obj / 空路径", () => {
    const root = objOf({ a: { value: numLit(1) } });
    expect(projectAbsPath(root, ["missing"])).toBeUndefined();
    expect(projectAbsPath(numLit(1), ["a"])).toBeUndefined();
    expect(projectAbsPath(root, [])).toBe(root);
  });
});

describe("ownPropHolder：自有槽持有者", () => {
  it("obj 自身 / brand 内层 obj", () => {
    const inner = objOf({ x: { value: numLit(1) } });
    expect(ownPropHolder(inner)).toBe(inner);
    const brand = abs({ k: "brand", name: "Box", shape: inner }, undefined, undefined, "exact");
    expect(ownPropHolder(brand)).toBe(inner);
  });

  it("无自有槽模型 ⇒ undefined（prim / brand 包 prim）", () => {
    expect(ownPropHolder(numLit(1))).toBeUndefined();
    const brandPrim = abs(
      { k: "brand", name: "X", shape: numLit(1) },
      undefined,
      undefined,
      "exact",
    );
    expect(ownPropHolder(brandPrim)).toBeUndefined();
  });
});
