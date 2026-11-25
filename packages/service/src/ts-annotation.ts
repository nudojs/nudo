/**
 * Bug 479：`.ts` 源的 **TS 类型注解**（service 侧消费点）。
 *
 * 解析层（core `packages/core/src/strip-types.ts`）把注解的**源码文本**留在
 * AST 节点的**不可枚举**旁路上（形参 `nudoTypeText` / 返回
 * `nudoReturnTypeText`；结构节点走 `nudoTypeNode` 旁路），core 的
 * `param-surface.ts` 再经 `FormalParam.tsType` 带出。本文件把注解接到 service
 * 的两个面上：
 *
 * 1. **推断面**（入口 / 返回注解 → Abs）：{@link annotationEnvForFile} 是
 *    文件级注解环境的唯一拼装点（跨文件导入表 + 同文件声明 + 类型参数），
 *    映射单点是 core 的 `absTypeForTsAnnotation`（节点优先、文本兜底）——
 *    与 core 泛化面同一张表，别名 / 泛型 / 联合 / 对象类型都按它映射。
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
import { importedTypeTablesFor } from "./type-annotation-resolve.ts";
import type { Abs, Shape } from "@nudojs/core";
import { abs as makeAbsVal, anyAbs, spread, withProvenance } from "@nudojs/core";
import {
  absShapeForTsTypeText,
  absTypeForTsAnnotation,
  absTypeForTsTypeText,
  sameFileAnnotationEnv,
  typeParamEnvForFunction,
  keySetIncompleteAbs,
  markKeySetOpenAbs,
  type AnnotationEnv,
  type ImportedTypeTables,
} from "@nudojs/core/internal";

/** 跨文件四张表都空 ⇒ 不给工厂造空底表。 */
function importedEnvOf(tables: ImportedTypeTables): AnnotationEnv | undefined {
  if (
    tables.namedTexts.size === 0 &&
    tables.namedNodes.size === 0 &&
    tables.inlineTexts.size === 0 &&
    tables.inlineNodes.size === 0
  ) {
    return undefined;
  }
  return {
    namedTypes: tables.namedTexts,
    namedTypeNodes: tables.namedNodes,
    importTypes: tables.inlineTexts,
    importTypeNodes: tables.inlineNodes,
  };
}

/**
 * service 侧**文件级注解环境工厂**（入口注解解析的唯一拼装点）。
 *
 * 跨文件类型声明表（具名导入 / inline import × 文本 / 节点，按被导入文件
 * 签名失效）在前，同文件声明 / `typeof` 值表在后（同文件声明覆盖导入别名）
 * ——合并与 core 消费方同一个工厂（`sameFileAnnotationEnv`）。`fnName` 给出
 * 时附该函数的类型参数表。
 */
export function annotationEnvForFile(
  source: string,
  filePath?: string,
  fnName?: string,
): AnnotationEnv {
  const base = filePath ? importedEnvOf(importedTypeTablesFor(source, filePath)) : undefined;
  const env = sameFileAnnotationEnv(source, base);
  return fnName === undefined ? env : { ...env, typeParams: typeParamEnvForFunction(source, fnName) };
}

/**
 * 返回注解 → Abs（**分析期**解析，带同文件 / 导入 / inline import / 值表）。
 *
 * dts 的 `tsDeclaredReturn` 只拿到投影上下文，没有源码；把声明 Abs 在分析期
 * 算好随 `FunctionAnalysis` 带过去，才能做 declared-vs-observed 决议
 * （BUG-422 的 `keyof User` / 具名别名 / 索引访问）。
 */
export function declaredReturnAbsFor(
  node: unknown,
  source: string,
  filePath: string | undefined,
  fnName: string,
): Abs | undefined {
  const n = node as {
    nudoReturnTypeNode?: unknown;
    nudoReturnTypeText?: string;
  } | undefined;
  if (!n) return undefined;
  return absTypeForTsAnnotation(
    { text: n.nudoReturnTypeText, node: n.nudoReturnTypeNode },
    annotationEnvForFile(source, filePath, fnName),
    source,
  );
}

/**
 * 声明类型文本 → Abs 形状（不可映射 ⇒ undefined）。
 * 单源：core `ts-type-shape.ts` 的 `absShapeForTsTypeText`（经
 * `@nudojs/core/internal` 复用；保留本导出名，消费方零改动）。
 */
export function tsAnnotationShape(text: string | undefined): Shape | undefined {
  return absShapeForTsTypeText(text);
}

/**
 * 入口实参 Abs：声明类型可映射 ⇒ 该 Abs（conf `path`：形状已知、取值任意；
 * nullish 成员带 lit term）；不可映射 / 无注解 ⇒ **any**（无约束入口参数 =
 * 任意 JS 值）。
 *
 * BUG-205：开放对象（`{ a: number }` / `{}`）必须在 Abs 上带**键集不完备**
 * 标记，否则键家族（`Object.keys/values/entries`）把声明槽折成 exact 字面
 * 元组——一次**观测值**被发布成输出类型（dts 出 `["a"]`、guard 拒收函数自己
 * 产生的 `["a","c"]`）。标记是 Abs 级 prop-flags 侧表位，造新 Abs 就丢，所以
 * 播种面必须与 core 泛化面（generalize.ts 的 `annotationAbsOf`）同口径。
 *
 * 表达只用 core 既有传播面：「注解形状 ⊕ 键集不可判的未知对象」= `spread`
 * （与 `{...x}` 同一判据：任一侧键集不完备 ⇒ 结果不完备），不在本包另立
 * 第二套判定，也不复刻私有标记位。
 */
export function tsAnnotationArgAbs(
  text: string | undefined,
  env?: AnnotationEnv | ReadonlyMap<string, Abs>,
  namedTypes?: ReadonlyMap<string, string>,
): Abs {
  // Abs 面映射（不是 Shape 面）：`string | null` / `number | undefined` 的
  // nullish 字面量精度只能由 term 承载。Shape 面会把这类注解整条丢掉 ⇒
  // 入口实参退 any ⇒ entry@ 观测的返回位变宽（dts `string | unknown`、
  // zod `z.unknown()`、guard 恒真），与同一份产物里 `@param x - string | null`
  // 的注解原文自相矛盾；而 check 泛化面（generalize.ts）早已走 Abs 面。
  const resolvedEnv =
    env instanceof Map ? { typeParams: env, namedTypes } : env;
  const mapped = absTypeForTsTypeText(text, resolvedEnv);
  if (!mapped) return anyAbs;
  const base = makeAbsVal(mapped.shape, mapped.term, undefined, "path");
  // 开放对象的键集标记是 Abs 身份侧表：`markOpenObjKeys` 之后的 `spread`
  // 会造新 Abs，再套 `withProvenance` 会把标记丢掉 ⇒ 先标记，再打
  // provenance，最后在**新 Abs** 上重打键集标记。
  const marked = mapped.shape.k === "obj" ? markOpenObjKeys(base) : base;
  const declared = withProvenance(marked, "declared");
  return keySetIncompleteAbs(marked) ? markKeySetOpenAbs(declared) : declared;
}

/**
 * 递归给**对象槽**里的开放对象打键集不完备标记（与 core `markOpenObjSlots`
 * 同口径：`Object.keys(x.a.b)` 也必须是诚实的 partial——合法实参
 * `{a:{b:1, c:2}}` 的 `c` 不在声明槽里）。
 *
 * 标记只落在新 Abs 上：Shape 可被缓存 / 复用，改槽必须复制（copy-on-write），
 * 无变化时返回原 Abs（不额外分配）。
 */
function markOpenObjKeys(a: Abs): Abs {
  const s = a.shape;
  if (s.k !== "obj") return a;
  let slots: typeof s.slots | undefined;
  for (const [key, slot] of Object.entries(s.slots)) {
    const v = slot.value;
    if (v.shape.k !== "obj") continue;
    const marked = markOpenObjKeys(v);
    if (marked === v) continue;
    slots ??= { ...s.slots };
    slots[key] = { ...slot, value: marked };
  }
  const base = slots === undefined ? a : { ...a, shape: { ...s, slots } };
  return s.open === true ? spread(anyAbs, base) : base;
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
