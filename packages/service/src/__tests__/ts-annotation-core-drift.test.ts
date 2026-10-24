/**
 * 族 60 · 第 5 条 —— core `absShapeForTsTypeText` 未公共化 ⇒ service 侧**复刻**同表
 * ⇒ 本文件是两张表的**漂移门禁**。
 *
 * ## 为什么是门禁而不是「公共化」
 *
 * core 的 `absShapeForTsTypeText`（`packages/core/src/algebra/ts-type-shape.ts`）把 TS 声明类型文本
 * 映成 Abs 形状；service 的 `tsAnnotationShape`（`packages/service/src/ts-annotation.ts`）是**同表复刻**
 * —— 因为公共 API 冻结面**不得新增导出**（`packages/core/src/index.ts` /
 * `packages/core/src/algebra/index.ts` / `packages/core/src/algebra/exec/index.ts` /
 * `packages/core/src/algebra/internal.ts` 四张表零变更）⇒ **不公共化**。
 *
 * ⇒ 复刻的**唯一风险**是「core 侧扩表、service 侧没跟」⇒ 由本门禁**机器化**堵住：
 * 任一侧改表而另一侧没改 ⇒ 本钉立即红。
 *
 * ⚠ 本文件**故意**用**跨包相对路径** import core 的内部模块（仓内已有同款先例：
 * `packages/parser/src/__tests__/directive-scope-g2.test.ts` 相对 import core 的 `nudo-constraints.ts`）。
 * 这是**测试层**的取值，不是运行时依赖 ⇒ **不触**公共 API 冻结面。
 *
 * ## 负控
 *
 * 「不可映射 ⇒ undefined」这条口径本身也要钉住（改坏任一侧都会红）——
 * 且要钉住 `any` / `unknown` / `never` / `void` / `null` **不映射**（它们不是「一个具体值域」，
 * 落到 any 才是既有语义：无约束 ≠ unknown）。
 */
import { describe, it, expect } from "vitest";
import { tsAnnotationShape } from "../ts-annotation.ts";
import { absShapeForTsTypeText } from "../../../core/src/algebra/ts-type-shape.ts";

/** 两表都必须映射的 JS 一等类型（口径：只映射 JS 里同名的一等类型） */
const MAPPED = ["string", "number", "boolean", "bigint", "symbol"] as const;

/** 必须**不**映射的文本（别名 / 泛型 / 联合 / 对象类型 / 非值域类型） */
const UNMAPPED = [
  "any",
  "unknown",
  "never",
  "void",
  "null",
  "undefined",
  "object",
  "Array<string>",
  "string[]",
  "string | number",
  "MyAlias",
  "{ a: string }",
  "Promise<void>",
  "number & string",
  "",
] as const;

describe("族 60 · 第 5 条：service 的 tsAnnotationShape 与 core 的 absShapeForTsTypeText 同表", () => {
  it("可映射类型：两表给出**逐字相同**的形状", () => {
    for (const t of MAPPED) {
      // core 扩表而 service 没跟 ⇒ 这里红（service 与 core 对同一文本的映射必须一致）
      expect(tsAnnotationShape(t)).toEqual(absShapeForTsTypeText(t));
    }
  });

  it("不可映射类型：两表都返回 undefined（不猜）", () => {
    for (const t of UNMAPPED) {
      expect(tsAnnotationShape(t)).toBeUndefined();
      expect(absShapeForTsTypeText(t)).toBeUndefined();
    }
  });

  it("空 / 缺省输入：两表都返回 undefined", () => {
    for (const t of [undefined, "", "   "]) {
      expect(tsAnnotationShape(t)).toBeUndefined();
      expect(absShapeForTsTypeText(t)).toBeUndefined();
    }
  });

  it("前后空白：两表都 trim 后再判（口径一致）", () => {
    expect(tsAnnotationShape("  number  ")).toEqual(absShapeForTsTypeText("  number  "));
    expect(tsAnnotationShape("  number  ")).toEqual({ k: "prim", type: "number" });
  });

  it("负控：core 侧该函数**仍未进公共面**（冻结面零新增）", async () => {
    const pub = (await import("@nudojs/core")) as Record<string, unknown>;
    expect(pub.absShapeForTsTypeText).toBeUndefined();
  });
});
