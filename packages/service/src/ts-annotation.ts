/**
 * Bug 479：`.ts` 源的 **TS 类型注解**（service 侧唯一消费点）。
 *
 * 解析层（core `packages/core/src/strip-types.ts`）把注解的**源码文本**留在
 * AST 节点的**不可枚举**旁路上（形参 `nudoTypeText` / 返回
 * `nudoReturnTypeText`），core 的 `param-surface.ts` 再经 `FormalParam.tsType`
 * 带出。本文件把该文本接到 service 的两个面上：
 *
 * 1. **推断面**（entry@ 实参 / 形参类型）：声明类型文本 → Abs 形状。
 *    口径与 core `packages/core/src/algebra/ts-type-shape.ts` **同表**：只映射
 *    JS 一等类型 `string` / `number` / `boolean` / `bigint` / `symbol`；
 *    别名 / 泛型 / 联合 / 对象类型**不映射** ⇒ 回落「无约束 any」（不猜）。
 *    ⚠️ core 的 `absShapeForTsTypeText` 未进公共面（public-api 冻结），
 *    故此处**复刻**同表；core 侧扩表时**必须**同步本表（已上报主 agent）。
 * 2. **产物面**（dts 参数位）：声明类型文本 → TS 类型串，
 *    **保留注解原文**（源里写什么，声明位就是什么）。
 *    只放行「可安全落进 .d.ts」的文本：含注释记号（块注释 / 行注释）、换行或
 *    控制字符 ⇒ 不可放行（回落既有投影面，fail-closed）。
 *
 * 不变量 / Invariants:
 * - **无注解 = 无变化**：`.js` 源 / 未标注形参 ⇒ 本文件两个入口都返回
 *   「无注解」⇒ 调用方走既有路径（推断面 any、产物面 case-widen）。
 * - **不可映射 ≠ unknown**：推断面回落的是 **any**（无约束 = 任意 JS 值），
 *   不是 unknown（分析失败）——与 design-cli-semantics §2 一致。
 */
import type { Abs, Shape } from "@nudojs/core";
import { abs as makeAbsVal, anyAbs } from "@nudojs/core";

/**
 * 声明类型文本 → Abs 形状（不可映射 ⇒ undefined）。
 * 与 core `ts-type-shape.ts` 的 `absShapeForTsTypeText` 同表（勿单边扩表）。
 */
export function tsAnnotationShape(text: string | undefined): Shape | undefined {
  if (!text) return undefined;
  switch (text.trim()) {
    case "string":
      return { k: "prim", type: "string" };
    case "number":
      return { k: "prim", type: "number" };
    case "boolean":
      return { k: "prim", type: "boolean" };
    case "bigint":
      return { k: "prim", type: "bigint" };
    case "symbol":
      return { k: "prim", type: "symbol" };
    default:
      return undefined;
  }
}

/**
 * 入口实参 Abs：声明类型可映射 ⇒ 该形状（conf `path`：形状已知、取值任意）；
 * 不可映射 / 无注解 ⇒ **any**（无约束入口参数 = 任意 JS 值）。
 */
export function tsAnnotationArgAbs(text: string | undefined): Abs {
  const shape = tsAnnotationShape(text);
  return shape ? makeAbsVal(shape, undefined, undefined, "path") : anyAbs;
}

/**
 * 声明类型文本 → dts 类型串（**保留注解原文**）。
 *
 * 放行条件：非空、无注释记号（斜杠覆盖块注释与行注释两种记号）、无换行、
 * 无控制字符。不可放行 ⇒ undefined（调用方回落既有投影面）。
 *
 * 说明：注解文本取自**已解析的 TS 源**的类型节点区间 ⇒ 语法上必是合法 TS
 * 类型表达式；此处只排掉「会破坏 .d.ts 文本结构」的形态（注释 / 换行）。
 */
export function tsAnnotationTypeText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  // BUG-192：**换行不是拒绝理由**——TS 的 `.d.ts` 类型注解允许多行；把注解
  // 压成单行（声明行仍是单行）就保住**同一个类型**。旧口径「含换行 ⇒ 丢弃」
  // 让多行对象类型注解整段丢失（消费端假绿），同一注解写一行/多行产出**相反**
  // 的 `.d.ts`（产物随源码排版翻转）。
  const t = text.replace(/\s*[\r\n\u2028\u2029]+\s*/g, " ").trim();
  if (t.length === 0) return undefined;
  // 只挡**真正的注释记号**（`//` / `/*`）：它们会提前闭合 JSDoc / 破坏 .d.ts
  // 结构。旧口径挡「文本里出现 `/`」⇒ 字符串字面量里的 `"/"` 也被误伤。
  if (t.includes("//") || t.includes("/*")) return undefined;
  // 控制字符
  if (/[\u0000-\u001f\u007f]/.test(t)) return undefined;
  return t;
}
