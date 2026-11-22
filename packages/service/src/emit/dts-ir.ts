/**
 * dts 声明 IR · 第一切片：函数参数位模型 + 打印器。
 *
 * 背景（P3b）：`dts-generator.ts` 8.5k 行把「声明事实」和「文本拼装」混在
 * 一起。先把最常用、规则最稳定的参数位抽成模型：
 * - `DtsParam` 只描述声明事实（名字 / 类型 / 可选 / rest / 中间位 union）；
 * - `renderDtsParams` 只负责 TS 语法（TS1016 规则），不再读 Abs / 注解 / 契约。
 *
 * 这不是完整 IR；后续 module / class / return 面按同一方向迁移。
 */

/** 参数位（渲染前的中间形态）。 */
export type DtsParam = {
  /** 声明名（rest 带 `...`；pattern 是 `{ a, b }`） */
  name: string;
  /** 基础类型串（不含 `?` / `| undefined`） */
  type: string;
  /** 该位可省略 */
  optional: boolean;
  /** 剩余参数位（`...rest`）——不得被当成必填位触发 TS1016 降级 */
  isRest?: boolean;
  /** `T | undefined` 文本（可选位不在尾部时用） */
  unionText?: string;
};

/**
 * 渲染参数位列表。
 *
 * TS 规则：**可选位之后不得跟必填位**（TS1016）⇒ 可选位若不在尾部，只能
 * 渲染成 `T | undefined`（值可为 undefined，位置仍必填）。
 *
 * rest 位虽然 `optional: false`，但 TS 允许 `a?: number, ...rest: T[]`；
 * 从右往左扫时 rest 位**不**置 `requiredAfter`。
 */
export function renderDtsParams(slots: readonly DtsParam[]): string[] {
  const out: string[] = new Array(slots.length);
  let requiredAfter = false;
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i]!;
    const hasRequiredAfter = requiredAfter;
    if (!s.optional && !s.isRest) requiredAfter = true;
    if (s.optional && hasRequiredAfter) {
      out[i] = `${s.name}: ${s.unionText ?? `${s.type} | undefined`}`;
    } else {
      out[i] = s.optional ? `${s.name}?: ${s.type}` : `${s.name}: ${s.type}`;
    }
  }
  return out;
}

/** 函数 / 方法签名模型（参数文本已是声明事实，打印器只拼 TS 语法）。 */
export type DtsSignature = {
  /** 类型形参子句原文（`<T>` / `<T = string>`；无 ⇒ "" / undefined） */
  typeParams?: string;
  /** 接收者子句（`this: Box<T>`；无 ⇒ undefined） */
  thisParam?: string;
  /** 参数位文本（`a: number` / `...rest: string[]`） */
  params: readonly string[];
  /** 返回类型文本 */
  returnType: string;
};

/** 打印函数签名：`<T>(this: X, a: number): R`。 */
export function renderDtsSignature(sig: DtsSignature): string {
  const params =
    sig.thisParam === undefined ? sig.params : [sig.thisParam, ...sig.params];
  return `${sig.typeParams ?? ""}(${params.join(", ")}): ${sig.returnType}`;
}
