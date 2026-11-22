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

/**
 * 对象字面量成员函数的**源码注解证据**（BUG-157）：成员键 → 形参 / 返回注解原文。
 *
 * 求值面把对象字面量成员变成 `$fnVal([...形参名], fn, {…})`——成员没被调用时
 * 只有形参名，没有类型（`(a: unknown) => unknown`）。源码注解就在 AST 上，
 * 必须在投影时叠加进 Abs（只补缺：观测到的返回类型优先）。
 */
export interface DtsObjectFnAnnotation {
  /** 成员键（静态键；计算键不收） */
  key: string;
  /** 形参注解原文（与形参位平行；无注解 ⇒ undefined） */
  paramTypes: Array<string | undefined>;
  /** 该位是否 rest（rest 注解必须是数组类型才放行） */
  rest: boolean[];
  /** 方法 / 函数的返回注解原文 */
  returnType?: string;
}

/**
 * 模块级**值声明**面（BUG-190）：`export const/let/var` 与 TS `enum`。
 *
 * 这些绑定在导出面表里**已登记**（`exportBindings`），但旧实现只发射函数与类
 * ⇒ 发布的 `.d.ts` 里从不出现 ⇒ 消费端 `import { VERSION }` 报 TS2305
 * （而运行时确实有这些导出）。
 */
export interface DtsValueSurface {
  /** 声明种类（`const` / `let` / `var` / TS `enum`） */
  kind: "const" | "let" | "var" | "enum";
  /** enum 成员（源码序 + 字面量初始化器；非 enum ⇒ undefined） */
  enumMembers?: Array<{ name: string; init?: string }>;
  /** Bug 25：`export const enum` ⇒ 发射 `declare const enum`（否则运行时 import 报错） */
  constEnum?: boolean;
  /** Bug 20：`export default <表达式>` 无分析面绑定时预投影的类型串 */
  typeText?: string;
  /** Bug 77：`as const` ⇒ 对象槽按只读投影 */
  asConst?: boolean;
  /**
   * BUG-260：顶层 `const <ident> = <primitive literal>`。tsc 对这种绑定保留
   * 字面量类型；解构 / 对象初始化器仍按拓宽口径（`const {a} = {a:1}` ⇒
   * `a: number`），不能用同一把闸门。
   */
  literalConst?: boolean;
  /**
   * BUG-130：源码的类型注解原文（`export const c1: number[] = []` 的
   * `number[]`）。
   */
  annotation?: string;
  /**
   * BUG-140：初始化器**内部**有 `as const`（`{ x: [1, 2] as const }`）时按源码
   * 字面量投影的类型串。
   */
  nestedConstType?: string;
  /** BUG-157：对象字面量成员函数的源码注解（投影时叠加进 Abs，只补缺） */
  fnMemberAnnotations?: DtsObjectFnAnnotation[];
  /**
   * BUG-258 / BUG-254：初始化器 AST 的类型文本（仅 `typeof X` 引用与显式泛型
   * 实参这类 Abs 表达不了的声明事实优先于分析面观测）。
   */
  initTypeText?: string;
  /** BUG-264：`const s = Symbol("…")` ⇒ `unique symbol`。 */
  uniqueSymbol?: boolean;
  /** BUG-263：对象字面量里用户符号键的源码名（按出现序）。 */
  userSymbolKeys?: string[];
  /**
   * BUG-358：初始化器**不是**函数 / 类值（`export const handle = 1`）。
   *
   * 分析面可能把同名**对象成员键**误登记成模块级函数入口（`registry.handle`
   * 与 `const handle` 是两个实体）⇒ 当函数入口与一个非函数值绑定同名时，
   * 以值绑定为准：值声明照发、phantom 函数入口不发射。
   */
  nonFunctionValue?: boolean;
}

/**
 * namespace 面（BUG-191）：`export namespace NS { … }` 的成员声明文本。
 */
export interface DtsNamespaceSurface {
  /** 导出名（未导出 ⇒ undefined） */
  exportName?: string;
  /** 全部导出名（具名优先，其后的别名逐条补发） */
  exportNames?: string[];
  /** 成员声明行 */
  members: string[];
}

/**
 * 导入面（一条 import 声明里的**类型名** → 模块说明符）。
 *
 * Bug 233：brand 引用的类若来自**别的模块**（本模块 import 进来的），
 * 产物里必须能解析那个类名 ⇒ 补 `import type { C } from "…";`。
 */
export interface DtsImportSurface {
  /** 模块说明符（源码原文） */
  specifier: string;
  /** 导入形态：具名 / 默认 / `import x = require("…")` */
  kind: "named" | "default" | "equals";
  /**
   * BUG-012：具名导入的**原名**（`import { X as Y }` 里的 X）。再导出链条
   * （`export { Y as Z }`）要按原名写 `export { X as Z } from "…"`。
   */
  importedName?: string;
}

/** 类字段声明面（实例 / static 共用）。 */
export interface DtsClassFieldSurface {
  name: string;
  type: string;
  readonly?: boolean;
  optional?: boolean;
  accessibility?: "private" | "protected" | "public";
  isAbstract?: boolean;
  /** well-known symbol 键（`[Symbol.iterator]` ⇒ `@@iterator`）；发射还原括号形态 */
  symbolKey?: boolean;
}

/** 类方法声明面（实例 / static 共用）。 */
export interface DtsClassMethodSurface {
  name: string;
  params: string[];
  /** 与 params 平行的源码注解原文（无注解 ⇒ undefined） */
  paramTypes?: Array<string | undefined>;
  /** 与 params 平行的默认值证据（`m(x = 1)` ⇒ number） */
  paramDefaults?: Array<string | undefined>;
  accessibility?: "private" | "protected" | "public";
  isAbstract?: boolean;
  returnType?: string;
  annotationReturnType?: string;
  observedReturnType?: string;
  typeParams?: string;
  optional?: boolean;
  symbolKey?: boolean;
  /** 源码重载集（非空 ⇒ 实现签名不得再发） */
  overloads?: DtsClassMethodSurface[];
  declarationOnly?: boolean;
}

/** 访问器声明面。 */
export interface DtsClassAccessorSurface {
  name: string;
  kind: "get" | "set";
  type: string;
  isStatic?: boolean;
  accessibility?: "private" | "protected" | "public";
  symbolKey?: boolean;
}

/** 构造器重载声明面。 */
export interface DtsCtorSignatureSurface {
  params: string[];
  paramTypes?: Array<string | undefined>;
  accessibility?: "private" | "protected" | "public";
}

/** 类体成员面（不含导出形态）。 */
export interface DtsClassMemberSurface {
  instanceMethods: DtsClassMethodSurface[];
  staticMethods: DtsClassMethodSurface[];
  ctorParams?: string[];
  ctorAccessibility?: "private" | "protected" | "public";
  ctorParamTypes?: Array<string | undefined>;
  ctorOverloads?: DtsCtorSignatureSurface[];
  typeParams?: string[];
  typeParamsText?: string;
  superClass?: string;
  implements?: string[];
  superTypeArguments?: string[];
  superExpressionText?: string;
  instanceFields?: DtsClassFieldSurface[];
  staticFields?: DtsClassFieldSurface[];
  accessors?: DtsClassAccessorSurface[];
  isAbstract?: boolean;
  hasPrivateIdentifier?: boolean;
  indexSignatures?: string[];
}

/** 类声明面（成员面 + 导出形态）。 */
export interface DtsClassSurface extends DtsClassMemberSurface {
  exportName?: string;
  exportNames?: string[];
  isDefault: boolean;
  /** `export const C = class { … }`：值是构造器，不是类型名 */
  isExpression?: boolean;
}

/** 模块导出面（导出名 → 本地绑定 + 类 / 值 / namespace / 导入）。 */
export interface DtsModuleSurface {
  exportBindings: Map<string, string>;
  reexports: string[];
  typeOnlyExportBindings?: Map<string, string>;
  classes: Map<string, DtsClassSurface>;
  imports?: Map<string, DtsImportSurface>;
  values: Map<string, DtsValueSurface>;
  namespaces?: Map<string, DtsNamespaceSurface>;
  typeDeclarations?: string[];
  typeExportAliases?: string[];
  functionOverloads?: Map<string, { exported: boolean }>;
  typeNames?: Set<string>;
  valueNames?: Set<string>;
  typeParamClauses?: Map<string, string>;
  paramDefaults?: Map<string, Array<string | undefined>>;
  namespaceImports?: Map<string, string>;
  exportEquals?: {
    readonly local: string;
    members?: string[];
  };
}
