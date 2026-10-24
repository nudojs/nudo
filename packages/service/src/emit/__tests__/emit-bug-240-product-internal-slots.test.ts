/**
 * Bug 240 —— service **产物面**不得发布 internal 槽（私有字段 / 生成器协议槽）。
 *
 * 改前：
 *   export declare function f(x: { a: number; "#priv": number; "@@iterator": number }): number;
 * ⇒ 形参位把内部槽当**用户可见字段**直出：`widenParamAbs` 造新槽时丢了
 * `internal` / `symbolKey` 标记 ⇒ 内部槽被"提权"成可见字段（`"#priv"` 是私有
 * 字段、`"@@iterator"` 是 **symbol 键**协议槽——按字符串键发布是错的）。
 * 私有字段还会进 `declare class` 的类体。
 *
 * 判据与 core 三面**同款**（`format.ts` 投影面 / `projection.ts` 约束面 /
 * `denote.ts` guard 面）：`Slot.internal` 为 true 且键**不是**规范数组下标 ⇒
 * 该槽对属性 introspection 不可见 ⇒ 不进产物面。规范数组下标槽是例外（族 01
 * 口径：生成器的数字下标槽承载元素域）。
 *
 * 覆盖面：dts（形参位 / 类字段）/ schema（单值 + zod 模块）/ standard 模块。
 */
import { describe, it, expect } from "vitest";
import { abs, num, type Abs } from "@nudojs/core";
import {
  absToTSType,
  dtsModuleSurface,
  projectFunctionDts,
  projectModuleDts,
} from "../dts-generator.ts";
import { absToSchemaSource, absToZodSchemaModule } from "../schema-generator.ts";
import { absToStandardSchemaModule } from "../standard-schema.ts";

/** 带 internal 槽（私有字段 / symbol 协议槽）的对象 */
const objWithInternal = abs(
  {
    k: "obj",
    slots: {
      a: { value: num() },
      "#priv": { value: num(), internal: true },
      "@@iterator": { value: num(), internal: true, symbolKey: true },
    },
  },
  undefined,
  undefined,
  "exact",
);

/** 只带普通槽的对象（负控制） */
const plainObj = abs(
  { k: "obj", slots: { a: { value: num() } } },
  undefined,
  undefined,
  "exact",
);

/** brand（类实例类型），实例形状里带一个 internal 私有字段 */
const brandWithPrivate = abs(
  {
    k: "brand",
    name: "Counter",
    shape: abs(
      {
        k: "obj",
        slots: {
          v: { value: num() },
          "#priv": { value: num(), internal: true },
        },
      },
      undefined,
      undefined,
      "exact",
    ),
  },
  undefined,
  undefined,
  "exact",
);

/** 假 fn（形参位 / 返回位给定） */
function fakeFn(name: string, argAbs: Abs, outAbs: Abs): unknown {
  return {
    name,
    cases: [{ name: "c", argAbs: [argAbs], args: [], abs: outAbs }],
  };
}

/** 模块面 dts（CLI export --format dts 的产品面路径） */
function moduleDts(source: string, fn: unknown): string {
  const surface = dtsModuleSurface(source);
  const typed = fn as Parameters<typeof projectFunctionDts>[0];
  const projection = projectFunctionDts(typed, undefined, surface);
  return projectModuleDts(surface, [{ fn: typed, projection }]).lines.join("\n");
}

describe("Bug 240 —— 产物面不得发布 internal 槽", () => {
  it("dts 形参位：内部槽不进结构字段（改前：\"#priv\" / \"@@iterator\" 直出）", () => {
    const dts = moduleDts(
      `export function f(x) { return x; }\n`,
      fakeFn("f", objWithInternal, num()),
    );
    expect(dts).not.toContain("#priv");
    expect(dts).not.toContain("@@iterator");
    // 普通槽照旧
    expect(dts).toContain("a: number");
  });

  it("dts 类字段：私有字段不进 declare class 类体", () => {
    const dts = moduleDts(
      `export class Counter {\n  constructor(v) { this.v = v; }\n}\nexport function make() { return 1; }\n`,
      fakeFn("make", num(), brandWithPrivate),
    );
    expect(dts).toContain("declare class Counter");
    expect(dts).not.toContain("#priv");
    expect(dts).toContain("v: number");
  });

  it("schema 单值面：内部槽不进 zod 对象", () => {
    const source = absToSchemaSource(objWithInternal);
    expect(source).not.toContain("#priv");
    expect(source).not.toContain("@@iterator");
    expect(source).toContain("a:");
  });

  it("schema 模块面（zod）：内部槽不进产物", () => {
    const { source } = absToZodSchemaModule({ f: objWithInternal });
    expect(source).not.toContain("#priv");
    expect(source).not.toContain("@@iterator");
    expect(source).toContain("a:");
  });

  it("standard 模块面：内部槽不进产物", () => {
    const { source } = absToStandardSchemaModule({ f: objWithInternal });
    expect(source).not.toContain("#priv");
    expect(source).not.toContain("@@iterator");
    expect(source).toContain('"key":"a"');
  });

  it("schema 形状兜底路径（open 对象）：内部槽不进产物", () => {
    // open 对象 ⇒ 约束投影放弃 ⇒ 走 service 的形状兜底（`absToSchemaShape`，
    // 该路径原先不剔 internal 槽）；standard 面走的就是这条路径。
    const openObj = abs(
      {
        k: "obj",
        open: true,
        slots: {
          a: { value: num() },
          "#priv": { value: num(), internal: true },
          "@@iterator": { value: num(), internal: true, symbolKey: true },
        },
      },
      undefined,
      undefined,
      "exact",
    );
    const standard = absToStandardSchemaModule({ f: openObj });
    expect(standard.source).not.toContain("#priv");
    expect(standard.source).not.toContain("@@iterator");
    expect(standard.source).toContain('"key":"a"');
    const zod = absToZodSchemaModule({ f: openObj });
    expect(zod.source).not.toContain("#priv");
    expect(zod.source).not.toContain("@@iterator");
    expect(zod.source).toContain("a:");
  });

  it("负控制：非 internal 槽逐字不变", () => {
    expect(absToTSType(plainObj)).toBe("{ a: number }");
    expect(absToSchemaSource(plainObj)).toContain("a:");
  });
});
