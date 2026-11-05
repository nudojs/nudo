/**
 * A11 · `brand` 槽位启用的 core 侧回归钉。
 *
 * 台账第三次复测订正：dts 面已由 Bug 554 收口；「生成器身份在**展示
 * 投影面**可见」并非待修目标——族 65 / Bug 240 / Bug 99 已**有意**决定
 * 由运行面协议槽钉身份，展示面恒为 `{…}`（`eval-loop-return-join.test.ts`
 * 的 `/^\{/`、`eval-bug-212` 的精确串都钉住这条）。本槽位的真实价值是
 * **身份随 Abs 值携带**：dts 的 `iteratorTSType` 不再只能靠 `next` /
 * `@@iterator` 槽启发式（重建产物丢内部槽就认不出）。
 *
 * 纪律：形状仍是闭 obj（不动 `Shape` 判别联合）；**core `formatShape`
 * 逐字不变**；dts 的泛型实参由 service 侧推导，不输出裸 `Generator`
 * 到 .d.ts（TS2314）。dts 侧接线见
 * `service/src/emit/__tests__/emit-abs-brand-projection.test.ts`。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "../abs.ts";
import { snapshotAbs, substAbs } from "../hof.ts";
import { formatShape } from "../format/format.ts";
import { call } from "./eval-helpers.ts";

/** 求值得到生成器对象 Abs 本身。 */
function genObjectOf(fnName: string, asyncMode: boolean): Abs {
  const decl = asyncMode
    ? `export async function* ${fnName}() { yield 1; }`
    : `export function* ${fnName}() { yield 1; }`;
  return call(`${decl}\nexport function f() { return ${fnName}(); }`, "f").result as Abs;
}

describe("A11 · brand 生产点与搬运", () => {
  it("同步生成器对象携带 brand:Generator（形状仍是闭 obj）", () => {
    const g = genObjectOf("BrandGenSyncA", false);
    expect(g.shape.k).toBe("obj");
    expect(g.facets?.brand).toBe("Generator");
  });

  it("异步生成器对象携带 brand:AsyncGenerator", () => {
    const g = genObjectOf("BrandGenAsyncB", true);
    expect(g.facets?.brand).toBe("AsyncGenerator");
  });

  it("snapshotAbs / substAbs 整包搬运 brand", () => {
    const g = genObjectOf("BrandGenSnapC", false);
    expect(snapshotAbs(g).facets?.brand).toBe("Generator");
    expect(substAbs(g, new Map()).facets?.brand).toBe("Generator");
    const copy = snapshotAbs(g);
    copy.facets!.brand = "mutated";
    expect(g.facets?.brand).toBe("Generator");
  });
});

describe("A11 · brand 不发布到展示投影面（既有契约）", () => {
  it("生成器对象的 formatShape 仍是结构面，且保留数字下标元素域", () => {
    const g = genObjectOf("BrandGenFormatD", false);
    expect(g.facets?.brand).toBe("Generator");
    const text = formatShape(g);
    expect(text).toMatch(/^\{/);
    expect(text).toContain('"0": 1');
  });

  it("异步生成器对象的 formatShape 同样不发布身份", () => {
    expect(formatShape(genObjectOf("BrandGenFormatE", true))).toMatch(/^\{/);
  });

  it("快照后的生成器对象仍带 brand（身份不随侧表丢失）", () => {
    const snap = snapshotAbs(genObjectOf("BrandGenFormatF", false));
    expect(snap.facets?.brand).toBe("Generator");
    expect(formatShape(snap)).toMatch(/^\{/);
  });

  it("负控：普通对象不挂槽位 ⇒ 结构投影逐字不变", () => {
    const o = abs(
      { k: "obj", slots: { a: { value: numLit(1) } } },
      undefined,
      undefined,
      "exact",
    );
    expect(o.facets).toBeUndefined();
    expect(formatShape(o)).toBe("{ a: 1 }");
  });

  it("负控：未知 brand 值不改变 obj 结构投影", () => {
    const o = abs(
      { k: "obj", slots: { a: { value: numLit(1) } } },
      undefined,
      undefined,
      "exact",
    );
    o.facets = { brand: "SomeUserBrand" };
    expect(formatShape(o)).toBe("{ a: 1 }");
  });
});
