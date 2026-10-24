/**
 * contract --from-dts：把 TypeScript `.d.ts` **逆向**成可审阅契约草稿。
 *
 * 产品纪律（docs/design/cli-semantics.md）：
 * - 产物是 `@nudo:draft`，**不** ambient 绑定、**不**进 check 门禁。
 * - 人工审阅后复制进 `*.nudo.js` 才成为 L1 义务（C0：义务只来自显式契约）。
 * - dts 表达不了的 Pred 代数（x>0 ⇒ x+1>1）由作者在接受后手工加强。
 *
 * 映射：TS 类型节点 → 约束构建器 DSL（number()/shape()/fn()/…），
 * 不经 Abs 往返——保留形参名，草稿可直接改。
 *
 * 纪律（族 27 H8）：
 * - **不静默放宽**：模型不出 ⇒ 显式标注 + 计入 `stats.skipped`
 *   （汇总行是契约的一部分：丢了东西必须看得见）。
 * - **不静默收紧**：草稿不得比 TS 更严（`Partial` 全字段可选；
 *   `Promise` 外壳不剥——与收割面同口径）。
 * - 产物**必须能编译**：草稿只用 `@nudojs/core` 的构建器表面名 + 具体字面量。
 *   （公共 API 的 `lit` 是 Term 构造器、不是约束构建器 ⇒ 草稿用裸字面量，
 *   `lit(...)` 抄进侧车虽能跑，但 `tsc --strict` 会判红。）
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import ts from "typescript";
import {
  formatObjectKey,
  isJsBindingIdent,
  toJsBindingIdent,
} from "@nudojs/core/internal";

export type DtsExportDraft = {
  name: string;
  /** `fn({ … }, …)` 或值约束 DSL；不可投影 → undefined + note */
  dsl?: string;
  note?: string;
  kind: "function" | "value" | "class" | "other";
  /**
   * 投影了，但**有未建模的部分**（值域 / Promise 外壳 / 合并重载 / 未建模的
   * 类型引用）⇒ 汇总行把它计入 `skipped`（丢失必须如实计数）。
   */
  partial?: boolean;
};

export type DtsContractDraft = {
  label: string;
  files: string[];
  exports: DtsExportDraft[];
  draftSource: string;
  stats: {
    files: number;
    exports: number;
    skipped: number;
    /**
     * 目录模式被投影预算截断掉的 `.d.ts` 数。
     * 当前**不设**投影预算（Bug 1015：静默截断 + 汇总行说谎）⇒ 恒为 0；
     * 字段保留：将来引入预算时按此**如实计数**。
     */
    droppedFiles?: number;
    /** 目录模式**没能遍历**的目录 / 条目数（读失败 / 深度上限） */
    droppedDirs?: number;
  };
};

/**
 * 草稿里出现的约束构建器表面名。
 * 名单 = `@nudojs/core` 的导出 ∩ 侧车注入名（`CONSTRAINT_BUILDERS`）⇒
 * 草稿既能在 `tsc --strict` 下编译，抄进 `*.nudo.js` 也能被侧车装载。
 * `lit` **不在**名单里：公共 API 的 `lit` 是 Term 构造器（不是约束构建器）。
 */
const BUILDERS = [
  "fn",
  "number",
  "string",
  "boolean",
  "any",
  "shape",
  "array",
  "union",
  "partial",
] as const;

/** 一次类型投影的结果 */
type Dsl = {
  /** 约束 DSL 文本 */
  dsl: string;
  /** 该类型是否被**完整**建模（false ⇒ 有信息丢失 ⇒ 计入 skipped） */
  modeled: boolean;
  /** dsl 是裸字面量（不能链式 `.optional()`） */
  raw?: boolean;
};

/** 文件级符号表（`type` 别名 / `interface`）——草稿面与收割面同源解析 */
type DtsSymbols = {
  aliases: Map<string, ts.TypeAliasDeclaration>;
  interfaces: Map<string, ts.InterfaceDeclaration>;
  /**
   * **限定名**桶（`A.Opts`）——短名桶不带命名空间身份 ⇒ `A.Opts` 与 `B.Opts`
   * 会互相并入（Bug 792 同款：收割面用 `qualifiedInterfaces` 分桶）。
   */
  qualifiedAliases: Map<string, ts.TypeAliasDeclaration>;
  qualifiedInterfaces: Map<string, ts.InterfaceDeclaration>;
};

/** 投影上下文：符号表 + 备注累加器 + 深度 + 别名环保护 */
type DraftCtx = {
  symbols: DtsSymbols;
  notes: string[];
  depth: number;
  resolving: Set<string>;
  /**
   * 丢失计数（**声明数 − 条目数**）：重载被合并、被丢的 overload 等。
   * 汇总行必须如实反映它 ⇒ 共享引用（不是拷贝）。
   */
  lost: LostCounter;
};

/** 可变丢失计数器（跨 `child()` 共享） */
type LostCounter = { n: number };

function keywordDsl(
  node: ts.TypeNode,
): { dsl: string; raw?: boolean } | { unmodeled: string } | undefined {
  switch (node.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return { dsl: "number()" };
    case ts.SyntaxKind.StringKeyword:
      return { dsl: "string()" };
    case ts.SyntaxKind.BooleanKeyword:
      return { dsl: "boolean()" };
    // any / unknown：TS 语义就是「无约束」⇒ any() 是**忠实**映射
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
    // void 返回：调用方拿不到值 ⇒ 无返回义务
    case ts.SyntaxKind.VoidKeyword:
    // object：非原始类型 ⇒ 无约束（宽松但不引入假红）
    case ts.SyntaxKind.ObjectKeyword:
      return { dsl: "any()" };
    // null：TS 的**真 null 面**（不是 any()）——Bug 801
    case ts.SyntaxKind.NullKeyword:
      return { dsl: "null", raw: true };
    // undefined：TS 的**真 undefined 面**（union 里不能被 any() 吞掉）
    case ts.SyntaxKind.UndefinedKeyword:
      return { dsl: "undefined", raw: true };
    // never 是底类型：DSL 无底约束 ⇒ 标为未建模（不能静默放宽成 any()）
    case ts.SyntaxKind.NeverKeyword:
      return { unmodeled: "never (bottom type is not expressible)" };
    case ts.SyntaxKind.BigIntKeyword:
      return { unmodeled: "bigint" };
    case ts.SyntaxKind.SymbolKeyword:
      return { unmodeled: "symbol" };
    default:
      return undefined;
  }
}

/** 字面量类型 → 裸字面量 DSL（`lit` 在公共 API 里不是约束构建器 ⇒ 不用） */
function litDsl(node: ts.LiteralTypeNode): Dsl | undefined {
  const lit = node.literal;
  if (ts.isStringLiteral(lit)) return { dsl: JSON.stringify(lit.text), modeled: true, raw: true };
  if (ts.isNumericLiteral(lit)) return { dsl: lit.text, modeled: true, raw: true };
  if (lit.kind === ts.SyntaxKind.TrueKeyword) return { dsl: "true", modeled: true, raw: true };
  if (lit.kind === ts.SyntaxKind.FalseKeyword) return { dsl: "false", modeled: true, raw: true };
  if (lit.kind === ts.SyntaxKind.NullKeyword) return { dsl: "null", modeled: true, raw: true };
  if (
    ts.isPrefixUnaryExpression(lit) &&
    lit.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(lit.operand)
  ) {
    return { dsl: `-${lit.operand.text}`, modeled: true, raw: true };
  }
  return undefined;
}

function typeRefName(node: ts.TypeReferenceNode): string {
  const n = node.typeName;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isQualifiedName(n)) {
    const parts: string[] = [];
    let cur: ts.EntityName = n;
    while (ts.isQualifiedName(cur)) {
      parts.unshift(cur.right.text);
      cur = cur.left;
    }
    if (ts.isIdentifier(cur)) parts.unshift(cur.text);
    return parts.join(".");
  }
  return "?";
}

/**
 * 成员键：Identifier / StringLiteral / NumericLiteral / **可判定的计算成员名**。
 *
 * Bug 832 同款（草稿面）：计算成员名此前**整条丢弃**（返回 `undefined`）⇒
 * `[Symbol.iterator]()` 这类成员在草稿里消失 ⇒ 契约被悄悄放宽（假绿）。
 * 现在按**收割面同口径**（harvest-dts.ts `computedMemberName`）：
 * - `Symbol.iterator` → `@@iterator`（引擎的 symbol 槽名，与收割面同一个名字）
 * - `Symbol.asyncIterator` → `@@asyncIterator`
 * - 计算键的字符串字面量 → 该字面量文本
 *
 * 不可静态判定者（`[key]` / `[foo()]`）仍返回 `undefined` ⇒ **调用方必须留 note**
 * （成员被丢 ⇒ 汇总行不许说谎）。
 */
function memberKey(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const expr = name.expression;
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "Symbol"
    ) {
      if (expr.name.text === "iterator") return "@@iterator";
      if (expr.name.text === "asyncIterator") return "@@asyncIterator";
      return undefined;
    }
    if (ts.isStringLiteral(expr)) return expr.text;
    return undefined;
  }
  return undefined;
}

/**
 * 成员键 + 「取不到键就留 note」——成员被丢 ⇒ 必须**看得见**（汇总行说真话）。
 *
 * 改前：`memberToField` 对取不到键的成员**直接 return undefined** ⇒ 无 note ⇒
 * 汇总行报「0 skipped」⇒ 丢失零信号（Bug 832 同款）。
 */
function memberKeyOrNote(
  name: ts.PropertyName | undefined,
  what: string,
  ctx: DraftCtx,
): string | undefined {
  const key = memberKey(name);
  if (key !== undefined) return key;
  ctx.notes.push(`${what} member with a name that cannot be resolved statically is not projected`);
  return undefined;
}

/**
 * 对象字面量里的**键**（shape 字段 / enum 成员 / namespace 成员）——
 * 必须产出**合法 JavaScript**（Bug 834）。
 *
 * - 带引号 / 连字符的键（`"content-type"`）⇒ JSON 引号串（`formatObjectKey`）；
 * - `__proto__` ⇒ **计算属性名**：对象字面量里的 `__proto__: v`（即便写成
 *   `"__proto__"` 带引号）也会触发 `[[SetPrototypeOf]]` ⇒ 该成员从字面量里
 *   消失、字面量的原型还被改写（与收割面 `emitKey` 同口径）。
 */
function draftKey(key: string): string {
  if (key === "__proto__") return `["__proto__"]`;
  return formatObjectKey(key);
}

/** 裸字面量不能链式 `.optional()` ⇒ 用 union(字面量, undefined) 包一层 */
function optionalize(d: Dsl): string {
  // 字面量本身就是 `undefined` 时不必写两遍
  const base = !d.raw
    ? d.dsl
    : d.dsl === "undefined"
      ? "union(undefined)"
      : `union(${d.dsl}, undefined)`;
  return `${base}.optional()`;
}

/**
 * **约束位**（导出顶层 / fn 返回位）上的裸字面量要包一层 `union(…)`。
 *
 * 裸字面量（`null` / `undefined` / `42` / `"x"`）在**嵌套位**（shape 字段 /
 * union 成员 / 形参 / 数组元素）是合法 DSL（core 的 `asNestedConstraint` 接受
 * 具体字面量）⇒ 那里保持裸写。但在**约束位**裸写会坏：
 * - 顶层导出 `export const x = null;` ⇒ 抄进侧车后不是约束（装载报
 *   「not a Nudo constraint」）；
 * - fn 返回位 `fn({}, undefined)` ⇒ `undefined` 是「**无**返回约束」的哨兵 ⇒
 *   返回义务被静默吞掉（比 TS 松）。
 *
 * `union` 是 core 的**构建器表面名**（草稿模块与侧车两侧同义）⇒
 * `union(null)` 的 entry Abs 与 `lit(null)` 相同 ⇒ 与 TS 的 null 面同口径。
 */
function constraintSlot(d: Dsl): string {
  return d.raw ? `union(${d.dsl})` : d.dsl;
}

function typeToDsl(node: ts.TypeNode | undefined, ctx: DraftCtx): Dsl | undefined {
  if (!node) return undefined;
  if (ctx.depth > 6) {
    ctx.notes.push("type nesting too deep → any()");
    return { dsl: "any()", modeled: false };
  }
  const kw = keywordDsl(node);
  if (kw) {
    if ("dsl" in kw) {
      return { dsl: kw.dsl, modeled: true, ...(kw.raw ? { raw: true } : {}) };
    }
    ctx.notes.push(`unmodeled type '${kw.unmodeled}' → any()`);
    return { dsl: "any()", modeled: false };
  }

  if (ts.isLiteralTypeNode(node)) {
    return litDsl(node) ?? { dsl: "any()", modeled: false };
  }
  if (ts.isArrayTypeNode(node)) {
    const el = typeToDsl(node.elementType, child(ctx)) ?? { dsl: "any()", modeled: false };
    return { dsl: `array(${el.dsl})`, modeled: el.modeled };
  }
  if (ts.isUnionTypeNode(node)) {
    const parts: Dsl[] = [];
    for (const t of node.types) {
      const d = typeToDsl(t, child(ctx));
      parts.push(d ?? { dsl: "any()", modeled: false });
    }
    if (parts.length === 0) return { dsl: "any()", modeled: false };
    // 任一成员未建模 ⇒ 整个 union 降级（union(any(), X) 是空约束 ⇒ 不能留）
    if (parts.some((p) => !p.modeled)) {
      ctx.notes.push("union member not modeled → any()");
      return { dsl: "any()", modeled: false };
    }
    if (parts.length === 1) return parts[0]!;
    return { dsl: `union(${parts.map((p) => p.dsl).join(", ")})`, modeled: true };
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return typeToDsl(node.type, child(ctx));
  }
  if (ts.isTypeLiteralNode(node)) {
    const mark = noteMark(ctx);
    const dsl = membersToShape(node.members, ctx);
    return { dsl, modeled: ctx.notes.length === mark };
  }
  if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
    return fnSignatureDsl(node.parameters, node.type, ctx);
  }
  if (ts.isConditionalTypeNode(node)) {
    return conditionalDsl(node, ctx);
  }
  if (ts.isTypeReferenceNode(node)) {
    return typeRefDsl(node, ctx);
  }
  if (ts.isExpressionWithTypeArguments(node as unknown as ts.ExpressionWithTypeArguments)) {
    ctx.notes.push("unmodeled type reference → any()");
    return { dsl: "any()", modeled: false };
  }
  ctx.notes.push("unmodeled type → any()");
  return { dsl: "any()", modeled: false };
}

/**
 * 条件类型（`T extends U ? X : Y`）⇒ 草稿面按**收割面同口径**投影。
 *
 * 收割面（harvest-dts.ts `mapConditionalType`）：
 * - 「恒真」形态（`extends unknown`）⇒ 取**真支**；
 * - 判不出时（类型参数未定）⇒ 取**两支并集**（`absUnion([trueAbs, falseAbs])`）。
 *
 * 草稿面同款：恒真 ⇒ 只投影真支；判不出 ⇒ 两支都投影并取 union。
 * 草稿**比 TS 松**（TS 按实参选一支，草稿取并集）⇒ 不构成假红；
 * 但这是**降级**（信息丢失）⇒ 如实标注（note ⇒ 该导出计入 `skipped`，
 * 汇总行不许说谎）。
 */
function conditionalDsl(node: ts.ConditionalTypeNode, ctx: DraftCtx): Dsl {
  const ext = ts.isParenthesizedTypeNode(node.extendsType)
    ? node.extendsType.type
    : node.extendsType;
  if (ext.kind === ts.SyntaxKind.UnknownKeyword) {
    // 恒真：任何类型都 extends unknown（收割面同口径 ⇒ 只取真支）
    const t = typeToDsl(node.trueType, child(ctx));
    ctx.notes.push(
      "conditional type — the extends side is `unknown` (always true); only the true branch is projected",
    );
    if (!t) return { dsl: "any()", modeled: false };
    return { dsl: t.dsl, modeled: false, ...(t.raw ? { raw: true } : {}) };
  }
  const t = typeToDsl(node.trueType, child(ctx));
  const f = typeToDsl(node.falseType, child(ctx));
  // union(any(), X) 是空约束 ⇒ 任一支未建模 ⇒ 整体降级
  if (!t || !f || !t.modeled || !f.modeled) {
    ctx.notes.push(
      "conditional type — not decidable from the declaration and its branches are not modeled → any() (same as the harvest face's undecidable branch)",
    );
    return { dsl: "any()", modeled: false };
  }
  ctx.notes.push(
    "conditional type — not decidable from the declaration; both branches are projected (union), same as the harvest face",
  );
  if (t.dsl === f.dsl) {
    return { dsl: t.dsl, modeled: false, ...(t.raw ? { raw: true } : {}) };
  }
  return { dsl: `union(${t.dsl}, ${f.dsl})`, modeled: false };
}

/** 备注长度标记（判断某次投影是否新增了备注） */
function noteMark(ctx: DraftCtx): number {
  return ctx.notes.length;
}

function child(ctx: DraftCtx): DraftCtx {
  return {
    symbols: ctx.symbols,
    notes: ctx.notes,
    depth: ctx.depth + 1,
    resolving: ctx.resolving,
    lost: ctx.lost,
  };
}

/** `Record<K,V>` 的键：字面量 / 字面量联合 ⇒ 具名字段可表达 */
function literalKeys(node: ts.TypeNode | undefined): string[] | undefined {
  if (!node) return undefined;
  if (ts.isLiteralTypeNode(node)) {
    const lit = node.literal;
    if (ts.isStringLiteral(lit) || ts.isNumericLiteral(lit)) return [lit.text];
    return undefined;
  }
  if (ts.isUnionTypeNode(node)) {
    const out: string[] = [];
    for (const t of node.types) {
      const k = literalKeys(t);
      if (!k) return undefined;
      out.push(...k);
    }
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

/** `Record<K,V>`：键是字面量集合 ⇒ 值域**落到实现**；否则 DSL 无索引签名 */
function recordDsl(args: readonly ts.TypeNode[], ctx: DraftCtx): Dsl {
  const val = args[1] ? typeToDsl(args[1], child(ctx)) : undefined;
  const keys = literalKeys(args[0]);
  if (keys && keys.length > 0 && val) {
    const fields = keys.map((k) => `${draftKey(k)}: ${val.dsl}`);
    return { dsl: `shape({ ${fields.join(", ")} })`, modeled: val.modeled };
  }
  // 值域在 DSL 里**无法**落到实现（shape 只有具名字段）⇒ 如实降级 + 标注，
  // 绝不写「注释宣称有值域、实现却没有」的假声明（Bug 1013）。
  ctx.notes.push(
    "Record value domain is NOT modeled — the contract DSL has no index signature, so this position only requires an object (weaker than TypeScript)",
  );
  return { dsl: "shape({})", modeled: false };
}

/** `Partial<T>`：内层字段**全部**变可选（与 TS 同口径——不能比 TS 更严） */
function partialDsl(args: readonly ts.TypeNode[], ctx: DraftCtx): Dsl {
  const inner = args[0];
  if (!inner) {
    ctx.notes.push("Partial<> without a type argument → any()");
    return { dsl: "any()", modeled: false };
  }
  const d = typeToDsl(inner, child(ctx));
  if (!d) {
    ctx.notes.push("Partial<T> over an unmodeled type → any()");
    return { dsl: "any()", modeled: false };
  }
  if (!d.dsl.startsWith("shape(")) {
    // partial() 只接受 shape ⇒ 非 shape 的 Partial 无法表达 ⇒ 标注降级
    ctx.notes.push("Partial<T> over a non-shape type is not expressible → any()");
    return { dsl: "any()", modeled: false };
  }
  return { dsl: `partial(${d.dsl})`, modeled: d.modeled };
}

function typeRefDsl(node: ts.TypeReferenceNode, ctx: DraftCtx): Dsl {
  const name = typeRefName(node);
  const args = node.typeArguments ?? [];
  if (name === "Array" || name === "ReadonlyArray" || name === "readonly") {
    const el = args[0] ? typeToDsl(args[0], child(ctx)) : undefined;
    return { dsl: `array(${el?.dsl ?? "any()"})`, modeled: el?.modeled ?? false };
  }
  if (name === "Promise" || name === "PromiseLike") {
    // **不剥** Promise 外壳（收割面保留 eff/promise）⇒ 该位未建模 + 标注。
    // 剥掉外壳会把「返回义务」落在 resolve 之后的值上 ⇒ 契约先天不可满足（假红）。
    ctx.notes.push(
      `${name}<…> is not modeled — the Promise shell is kept (same as the harvest face); this position carries no constraint`,
    );
    return { dsl: "any()", modeled: false };
  }
  if (name === "Record") return recordDsl(args, ctx);
  if (name === "Partial") return partialDsl(args, ctx);

  // 同文件的 `type` 别名 ⇒ 解析（与收割面同源）——Bug 1011
  const alias = lookupAlias(name, ctx);
  if (alias) {
    if (ctx.resolving.has(name)) {
      ctx.notes.push(`type alias '${name}' is recursive → any()`);
      return { dsl: "any()", modeled: false };
    }
    ctx.resolving.add(name);
    const d = typeToDsl(alias.type, child(ctx));
    ctx.resolving.delete(name);
    if (!d) {
      ctx.notes.push(`type alias '${name}' has no type → any()`);
      return { dsl: "any()", modeled: false };
    }
    return d;
  }
  // 同文件的 `interface` ⇒ 展开成 shape（Partial<Local> 等特判依赖它）
  const iface = lookupInterface(name, ctx);
  if (iface) {
    const mark = noteMark(ctx);
    // 注册进 resolving ⇒ 继承环（A extends B extends A）不会无限展开
    ctx.resolving.add(name);
    const dsl = membersToShape(interfaceMembers(iface, ctx), ctx);
    ctx.resolving.delete(name);
    return { dsl, modeled: ctx.notes.length === mark };
  }
  ctx.notes.push(`unmodeled type reference '${name}' → any()`);
  return { dsl: "any()", modeled: false };
}

/**
 * 类型引用 ⇒ 本文件声明（**限定名优先**，与收割面同口径）。
 *
 * 限定名（`A.Opts`）⇒ 先查**限定名桶**（Bug 792 同款：短名桶不带命名空间身份 ⇒
 * `A.Opts` 与 `B.Opts` 会互相并入）。
 * 限定名的短名回退 ⇒ **只**认「ambient 模块块里的声明」（lodash 形态），
 * 与收割面 `interfaceDeclsOf` 的短名回退判据同口径。
 */
function lookupInterface(name: string, ctx: DraftCtx): ts.InterfaceDeclaration | undefined {
  if (!name.includes(".")) return ctx.symbols.interfaces.get(name);
  const qualified = ctx.symbols.qualifiedInterfaces.get(name);
  if (qualified) return qualified;
  const short = name.slice(name.lastIndexOf(".") + 1);
  const decl = ctx.symbols.interfaces.get(short);
  if (decl && inAmbientModuleBlock(decl)) return decl;
  return undefined;
}

/** 类型引用 ⇒ 本文件声明（别名，限定名优先）——见 `lookupInterface` */
function lookupAlias(name: string, ctx: DraftCtx): ts.TypeAliasDeclaration | undefined {
  if (!name.includes(".")) return ctx.symbols.aliases.get(name);
  const qualified = ctx.symbols.qualifiedAliases.get(name);
  if (qualified) return qualified;
  const short = name.slice(name.lastIndexOf(".") + 1);
  const decl = ctx.symbols.aliases.get(short);
  if (decl && inAmbientModuleBlock(decl)) return decl;
  return undefined;
}

/** 声明是否在 **ambient 模块块**里（`declare module "x" { … }`） */
function inAmbientModuleBlock(decl: ts.Node): boolean {
  let node: ts.Node | undefined = decl.parent;
  while (node) {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) return true;
    node = node.parent;
  }
  return false;
}

/**
 * interface 的成员 = **继承链上的成员** + 自身成员（TS 语义：继承的成员
 * 也在类型里）⇒ 只展开自身成员会**悄悄放宽**契约（假绿）。
 *
 * 继承的基接口不在本文件符号表里 / 是递归环 ⇒ 如实标注（note ⇒ 该导出
 * 计入 `skipped`），不静默丢成员。
 */
function interfaceMembers(iface: ts.InterfaceDeclaration, ctx: DraftCtx): ts.TypeElement[] {
  const out: ts.TypeElement[] = [];
  for (const clause of iface.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of clause.types) {
      const name = heritageBaseName(t);
      const base = name ? lookupInterface(name, ctx) : undefined;
      if (!base || !name) {
        ctx.notes.push(
          `interface '${iface.name.text}' extends ${name ?? "a non-local type"} — the inherited members are not modeled`,
        );
        continue;
      }
      if (ctx.resolving.has(name)) {
        ctx.notes.push(`interface '${name}' is recursive — the inherited members are not modeled`);
        continue;
      }
      ctx.resolving.add(name);
      out.push(...interfaceMembers(base, ctx));
      ctx.resolving.delete(name);
    }
  }
  out.push(...iface.members);
  return out;
}

/** heritage 子句里的基类型名（`Base` / `NS.Base`）——收割面同口径 */
function heritageBaseName(t: ts.ExpressionWithTypeArguments): string | undefined {
  const expr = t.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    ts.isIdentifier(expr.name)
  ) {
    return `${expr.expression.text}.${expr.name.text}`;
  }
  return undefined;
}

/** 类型字面量 / interface 的成员 ⇒ shape */
function membersToShape(members: readonly ts.TypeElement[], ctx: DraftCtx): string {
  const fields: string[] = [];
  let dropped = 0;
  for (const m of members) {
    const field = memberToField(m, ctx);
    if (field === undefined) {
      dropped++;
      continue;
    }
    fields.push(field);
  }
  if (fields.length === 0) {
    if (dropped > 0) {
      // 成员全被丢 ⇒ 不能返回 shape({})（那是「无约束」）⇒ 未建模
      ctx.notes.push("all members of the type are unmodeled → any()");
      return "any()";
    }
    return "shape({})";
  }
  return `shape({ ${fields.join(", ")} })`;
}

function memberToField(m: ts.TypeElement, ctx: DraftCtx): string | undefined {
  if (ts.isPropertySignature(m)) {
    const key = memberKeyOrNote(m.name, "property", ctx);
    if (key === undefined) return undefined;
    const d = typeToDsl(m.type, child(ctx)) ?? { dsl: "any()", modeled: false };
    const v = m.questionToken ? optionalize(d) : d.dsl;
    return `${draftKey(key)}: ${v}`;
  }
  if (ts.isMethodSignature(m)) {
    // 方法签名成员**必须保留**（丢了就悄悄放宽了契约）——Bug 945
    const key = memberKeyOrNote(m.name, "method", ctx);
    if (key === undefined) return undefined;
    const d = fnSignatureDsl(m.parameters, m.type, ctx);
    const v = m.questionToken ? optionalize(d) : d.dsl;
    return `${draftKey(key)}: ${v}`;
  }
  if (ts.isIndexSignatureDeclaration(m)) {
    ctx.notes.push("index signature member is not modeled (the contract DSL has no index signature)");
    return undefined;
  }
  if (ts.isCallSignatureDeclaration(m) || ts.isConstructSignatureDeclaration(m)) {
    ctx.notes.push("call/construct signature member is not modeled");
    return undefined;
  }
  if (ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
    ctx.notes.push("accessor member is not modeled");
    return undefined;
  }
  ctx.notes.push("member of an unsupported form is not projected");
  return undefined;
}

/**
 * 一个**形参槽**（名字 / 可选性 / 类型 DSL / 是否完整建模）。
 *
 * 拆成结构是为了让**重载集**能按位合并（见 `mergeParamSlots`）——
 * 合并要在**可选化之前**做，否则可选位会被 union 包两层。
 */
type ParamSlot = {
  name: string;
  optional: boolean;
  /** 类型 DSL（**可选化之前**） */
  dsl: string;
  /** dsl 是裸字面量（不能链式 `.optional()`） */
  raw?: boolean;
  /** 是否完整建模（false ⇒ 不参与按位合并） */
  modeled: boolean;
  /** 原样写（不做可选化）——「无类型标注」位的既有措辞 */
  plain?: boolean;
};

function paramSlots(
  params: readonly ts.ParameterDeclaration[],
  ctx: DraftCtx,
): ParamSlot[] {
  const out: ParamSlot[] = [];
  params.forEach((p, i) => {
    const name = p.name && ts.isIdentifier(p.name) ? p.name.text : `p${i}`;
    // 族 27 Bug 794（草稿面）：`this` 形参不是**调用实参**位 ⇒ 写进契约
    // 会让元数 +1（第一个真实实参被绑到 `this` 槽）。判据同收割面。
    if (name === "this") return;
    if (p.dotDotDotToken) {
      ctx.notes.push(`${name}: rest parameter → array(any())`);
      out.push({ name, optional: false, dsl: "array(any())", modeled: false });
      return;
    }
    const optional = Boolean(p.questionToken) || Boolean(p.initializer);
    const d = typeToDsl(p.type, child(ctx));
    if (!d) {
      ctx.notes.push(`${name}: no type annotation → any()`);
      out.push({ name, optional, dsl: "any()", modeled: false, plain: true });
      return;
    }
    out.push({
      name,
      optional,
      dsl: d.dsl,
      ...(d.raw ? { raw: true } : {}),
      modeled: d.modeled,
    });
  });
  return out;
}

/** 形参槽 ⇒ 契约文本（可选位在这里才可选化） */
function slotText(s: ParamSlot): string {
  if (s.plain) return s.dsl;
  if (!s.optional) return s.dsl;
  return optionalize({
    dsl: s.dsl,
    modeled: s.modeled,
    ...(s.raw ? { raw: true } : {}),
  });
}

/** 形参槽 ⇒ `{ a: number(), b: string() }` */
function slotsToDsl(slots: readonly ParamSlot[]): string {
  const fields = slots.map((s) => `${s.name}: ${slotText(s)}`);
  return fields.length === 0 ? "{}" : `{ ${fields.join(", ")} }`;
}

function paramsDsl(params: readonly ts.ParameterDeclaration[], ctx: DraftCtx): string {
  return slotsToDsl(paramSlots(params, ctx));
}

/**
 * 重载集的**按位合并**（与收割面同口径，族 27 Bug 827）：
 * 元数相同 + 每位都完整建模 + 每位可选性一致 ⇒ 该位取**各重载的并集**。
 *
 * 元数**不同** ⇒ **不合并**（收割面同口径：把元数改成最宽的那个，会让
 * `f("a")` 变成「参数不够」⇒ 假红）⇒ 取首个重载，并**明确标注窄口径**。
 */
function mergeParamSlots(per: readonly ParamSlot[][]): ParamSlot[] | undefined {
  const first = per[0];
  if (!first || first.length === 0) return undefined;
  const out: ParamSlot[] = [];
  for (let i = 0; i < first.length; i++) {
    const slot = first[i]!;
    const texts: string[] = [];
    let ok = true;
    for (const slots of per) {
      const s = slots[i];
      if (!s || s.optional !== slot.optional || !s.modeled || !slot.modeled) {
        ok = false;
        break;
      }
      if (!texts.includes(s.dsl)) texts.push(s.dsl);
    }
    if (!ok) return undefined;
    // 合并后的 DSL：多位 ⇒ union（**构建器**，不是裸字面量 ⇒ 可选化时不重复包 union）
    const mergedText = texts.length === 1 ? texts[0]! : `union(${texts.join(", ")})`;
    out.push({
      name: slot.name,
      optional: slot.optional,
      dsl: mergedText,
      modeled: true,
      ...(texts.length === 1 && slot.raw ? { raw: true } : {}),
    });
  }
  return out;
}

function fnSignatureDsl(
  params: readonly ts.ParameterDeclaration[],
  ret: ts.TypeNode | undefined,
  ctx: DraftCtx,
): Dsl {
  const p = paramsDsl(params, ctx);
  const r = typeToDsl(ret, child(ctx));
  if (!r) {
    // 无返回类型标注 ⇒ 无返回义务（不是「必须返回 undefined」）
    return { dsl: `fn(${p}, any())`, modeled: true };
  }
  // 返回位是**约束位** ⇒ 裸字面量（`undefined` / `null`）要包 union
  return { dsl: `fn(${p}, ${constraintSlot(r)})`, modeled: r.modeled };
}

function pickName(decl: ts.NamedDeclaration): string | undefined {
  return decl.name && ts.isIdentifier(decl.name) ? decl.name.text : undefined;
}

function isExported(stmt: ts.Node): boolean {
  const mods = (stmt as ts.HasModifiers).modifiers;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function isDefaultExported(stmt: ts.Node): boolean {
  const mods = (stmt as ts.HasModifiers).modifiers;
  return mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

/**
 * 文件级符号表：`type` 别名 / `interface`。
 *
 * **命名空间**（`declare namespace A { … }`）里的声明**按限定名登记**
 * （`A.Opts`）——Bug 792 同款：短名桶不带命名空间身份 ⇒ `A.Opts` 与 `B.Opts`
 * 会互相并入（收割面用 `qualifiedInterfaces` 分桶，草稿面同款）。
 *
 * `declare global { … }` 的 `global` **不是**命名空间（TS 侧是全局作用域）⇒
 * 不进限定名链。
 */
function collectSymbols(sf: ts.SourceFile): DtsSymbols {
  const aliases = new Map<string, ts.TypeAliasDeclaration>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const qualifiedAliases = new Map<string, ts.TypeAliasDeclaration>();
  const qualifiedInterfaces = new Map<string, ts.InterfaceDeclaration>();
  const walk = (stmts: readonly ts.Statement[], ns: string[]): void => {
    for (const stmt of stmts) {
      if (ts.isTypeAliasDeclaration(stmt)) {
        if (!aliases.has(stmt.name.text)) aliases.set(stmt.name.text, stmt);
        const q = [...ns, stmt.name.text].join(".");
        if (q !== stmt.name.text && !qualifiedAliases.has(q)) qualifiedAliases.set(q, stmt);
      } else if (ts.isInterfaceDeclaration(stmt)) {
        if (!interfaces.has(stmt.name.text)) interfaces.set(stmt.name.text, stmt);
        const q = [...ns, stmt.name.text].join(".");
        if (q !== stmt.name.text && !qualifiedInterfaces.has(q)) qualifiedInterfaces.set(q, stmt);
      } else if (
        ts.isModuleDeclaration(stmt) &&
        stmt.body &&
        ts.isModuleBlock(stmt.body) &&
        ts.isIdentifier(stmt.name) &&
        stmt.name.text !== "global"
      ) {
        walk(stmt.body.statements, [...ns, stmt.name.text]);
      }
    }
  };
  walk(sf.statements, []);
  return { aliases, interfaces, qualifiedAliases, qualifiedInterfaces };
}

/** 本地声明表（`export { x }` 的本地再导出解析用） */
function collectLocals(stmts: readonly ts.Statement[]): Map<string, ts.Statement> {
  const out = new Map<string, ts.Statement>();
  const put = (name: string | undefined, stmt: ts.Statement): void => {
    if (name && !out.has(name)) out.set(name, stmt);
  };
  for (const stmt of stmts) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) put(pickName(d), stmt);
      continue;
    }
    if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt) ||
      ts.isModuleDeclaration(stmt)
    ) {
      put(pickName(stmt), stmt);
    }
  }
  return out;
}

function takeNotes(ctx: DraftCtx): string[] {
  const out = ctx.notes.slice();
  ctx.notes.length = 0;
  return out;
}

/** 枚举成员的运行时值（数字枚举自增 / 字面量初始化） */
function enumMemberValue(
  m: ts.EnumMember,
  counter: { value: number },
  ctx: DraftCtx,
): string | undefined {
  const init = m.initializer;
  if (!init) {
    const v = counter.value;
    counter.value = v + 1;
    return String(v);
  }
  if (ts.isStringLiteral(init)) return JSON.stringify(init.text);
  if (ts.isNumericLiteral(init)) {
    const v = Number(init.text);
    counter.value = v + 1;
    return init.text;
  }
  if (
    ts.isPrefixUnaryExpression(init) &&
    init.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(init.operand)
  ) {
    const v = -Number(init.operand.text);
    counter.value = v + 1;
    return `-${init.operand.text}`;
  }
  ctx.notes.push("enum member with a computed initializer is not projected");
  return undefined;
}

/** namespace 的运行时成员 ⇒ shape 字段 */
function namespaceMemberField(stmt: ts.Statement, ctx: DraftCtx): string | undefined {
  if (!isExported(stmt)) return undefined;
  if (ts.isVariableStatement(stmt)) {
    const fields: string[] = [];
    for (const d of stmt.declarationList.declarations) {
      const name = pickName(d);
      if (!name) continue;
      if (d.type) {
        const t = typeToDsl(d.type, child(ctx));
        if (!t) continue;
        fields.push(`${draftKey(name)}: ${t.dsl}`);
        continue;
      }
      const init = d.initializer;
      if (init && (ts.isStringLiteral(init) || ts.isNumericLiteral(init))) {
        const raw = ts.isStringLiteral(init) ? JSON.stringify(init.text) : init.text;
        fields.push(`${draftKey(name)}: ${raw}`);
        continue;
      }
      ctx.notes.push(`namespace member '${name}' has no inferable value type`);
    }
    return fields.length > 0 ? fields.join(", ") : undefined;
  }
  if (ts.isFunctionDeclaration(stmt)) {
    const name = pickName(stmt);
    if (!name) return undefined;
    const d = fnSignatureDsl(stmt.parameters, stmt.type, ctx);
    return `${draftKey(name)}: ${d.dsl}`;
  }
  if (ts.isEnumDeclaration(stmt)) {
    const name = pickName(stmt);
    if (!name) return undefined;
    const inner = enumShape(stmt, ctx);
    return `${draftKey(name)}: ${inner}`;
  }
  if (ts.isModuleDeclaration(stmt)) {
    const name = pickName(stmt);
    if (!name || !stmt.body || !ts.isModuleBlock(stmt.body)) return undefined;
    const fields: string[] = [];
    for (const inner of stmt.body.statements) {
      const f = namespaceMemberField(inner, ctx);
      if (f) fields.push(f);
    }
    return `${draftKey(name)}: shape({ ${fields.join(", ")} })`;
  }
  return undefined;
}

/** enum ⇒ 运行时对象 shape（成员值 = 字面量） */
function enumShape(decl: ts.EnumDeclaration, ctx: DraftCtx): string {
  const fields: string[] = [];
  const counter = { value: 0 };
  for (const m of decl.members) {
    const key = memberKey(m.name);
    if (key === undefined) {
      ctx.notes.push("enum member with a computed name is not projected");
      continue;
    }
    const value = enumMemberValue(m, counter, ctx);
    if (value === undefined) continue;
    fields.push(`${draftKey(key)}: ${value}`);
  }
  return fields.length === 0 ? "shape({})" : `shape({ ${fields.join(", ")} })`;
}

/**
 * 顶层函数的重载组 ⇒ 合并（**与收割面同口径**，族 27 Bug 827）。
 *
 * - **元数相同** ⇒ 形参**按位合并**（该位取各 overload 的并集），返回取 union；
 * - **元数不同** ⇒ **不合并形参**（取首个 overload）：把元数改成最宽的那个，会让
 *   `f("a")` 变成「参数不够」⇒ 假红（收割面同口径）⇒ 取首个 + **明确标注窄口径**。
 *
 * 重载**不能静默塌成第一个 overload**（Bug 825）：合并结果里保留**全部**
 * overload 的返回类型（union），并把**每条 overload 的签名**写进 note ⇒
 * 审阅者看得见「这里本来有 N 条」。被合并掉的 overload **计入 lost**
 * ⇒ 汇总行的 `skipped` 如实反映丢失。
 */
function mergeOverloads(
  decls: readonly ts.FunctionDeclaration[],
  ctx: DraftCtx,
): {
  dsl: Dsl;
  sigs: string[];
  /** 形参是否按位合并了（false ⇒ 取首个 overload 的形参） */
  paramsMerged: boolean;
  /** 合并后的元数（= 首个 overload 的元数） */
  arity: number;
  /** 各 overload 的元数是否不同 */
  arityDiffers: boolean;
} {
  const first = decls[0]!;
  if (decls.length === 1) {
    const d = fnSignatureDsl(first.parameters, first.type, ctx);
    return {
      dsl: d,
      sigs: [d.dsl],
      paramsMerged: true,
      arity: arityOf(first),
      arityDiffers: false,
    };
  }
  const slotsPer: ParamSlot[][] = [];
  const rets: Dsl[] = [];
  const sigs: string[] = [];
  for (const d of decls) {
    const slots = paramSlots(d.parameters, ctx);
    slotsPer.push(slots);
    const params = slotsToDsl(slots);
    const r = typeToDsl(d.type, child(ctx));
    const ret = r ?? { dsl: "any()", modeled: true };
    rets.push(ret);
    sigs.push(`fn(${params}, ${constraintSlot(ret)})`);
  }
  const arity = slotsPer[0]!.length;
  const arityDiffers = slotsPer.some((s) => s.length !== arity);
  const merged = arityDiffers ? undefined : mergeParamSlots(slotsPer);
  const p = slotsToDsl(merged ?? slotsPer[0]!);
  if (rets.some((r) => !r.modeled)) {
    ctx.notes.push("an overload return type is not modeled → any()");
    return {
      dsl: { dsl: `fn(${p}, any())`, modeled: false },
      sigs,
      paramsMerged: merged !== undefined,
      arity,
      arityDiffers,
    };
  }
  // 同名 overload 的返回类型去重（保留**每条** overload 的类型，见 note）
  const uniq = new Map<string, Dsl>();
  for (const r of rets) if (!uniq.has(r.dsl)) uniq.set(r.dsl, r);
  const texts = [...uniq.values()];
  const ret =
    texts.length === 1
      ? constraintSlot(texts[0]!)
      : `union(${texts.map((r) => r.dsl).join(", ")})`;
  return {
    dsl: { dsl: `fn(${p}, ${ret})`, modeled: true },
    sigs,
    paramsMerged: merged !== undefined,
    arity,
    arityDiffers,
  };
}

/** 函数声明的元数（`this` 形参不是实参位 ⇒ 不计） */
function arityOf(d: ts.FunctionDeclaration): number {
  let n = 0;
  for (const p of d.parameters) {
    if (p.name && ts.isIdentifier(p.name) && p.name.text === "this") continue;
    n++;
  }
  return n;
}

/**
 * 收集一个源文件的导出草稿条目。
 *
 * 返回值里的 `lost` = **声明数 − 条目数**（被合并 / 被丢的声明数）⇒
 * 汇总行的 `skipped` 必须把它算进去（汇总行是契约的一部分）。
 */
function collectExports(sourceFile: ts.SourceFile): {
  exports: DtsExportDraft[];
  lost: number;
} {
  const symbols = collectSymbols(sourceFile);
  const ctx: DraftCtx = {
    symbols,
    notes: [],
    depth: 0,
    resolving: new Set(),
    lost: { n: 0 },
  };
  const out: DtsExportDraft[] = [];
  /** 重载组：同名函数声明合并（Bug 825）——ambient 块的来源标记随组带过去 */
  const fnGroups = new Map<
    string,
    { decls: ts.FunctionDeclaration[]; ambient: string | undefined }
  >();
  const emittedFns = new Set<string>();

  const push = (e: DtsExportDraft): void => {
    const notes = takeNotes(ctx);
    if (notes.length > 0) {
      e.note = e.note ? `${e.note}; ${notes.join("; ")}` : notes.join("; ");
      if (e.dsl !== undefined) e.partial = true;
    }
    out.push(e);
  };

  /**
   * 带 **ambient 块**标记的 push。
   *
   * ambient 模块体（`declare module "x" { … }`）里的导出**不是本文件的导出**
   * ⇒ 如实标注 + 标 partial ⇒ 该条计入 `skipped`（汇总行不许说谎）：
   * 改前整个 ambient 体**既不可见也不计数**（汇总行报「0 skipped」）。
   */
  const pushScoped = (e: DtsExportDraft, ambient: string | undefined): void => {
    if (ambient) {
      e.note = e.note ? `${e.note}; ${ambient}` : ambient;
      if (e.dsl !== undefined) e.partial = true;
    }
    push(e);
  };

  const fnDecl = (stmt: ts.FunctionDeclaration, name: string, ambient: string | undefined): void => {
    const group = fnGroups.get(name);
    if (group) group.decls.push(stmt);
    else fnGroups.set(name, { decls: [stmt], ambient });
  };

  /**
   * 遍历一个语句列表（文件顶层 / ambient 模块体）。
   *
   * `prefix` = 外层 ambient 块的**名字前缀**（ambient 模块 "x" ⇒ `x.`）；
   * `ambient` = 外层 ambient 块的说明（undefined = 文件顶层）。
   */
  const collectStatements = (
    stmts: readonly ts.Statement[],
    prefix: string,
    ambient: string | undefined,
  ): void => {
    const locals = collectLocals(stmts);
    for (const stmt of stmts) {
      // export function / export declare function / export default function
      if (ts.isFunctionDeclaration(stmt)) {
        const exported = isExported(stmt);
        const isDefault = isDefaultExported(stmt);
        if (!exported && !isDefault) continue;
        // 具名 default 导出的**模块导出名**是 `default`（不是本地名）——Bug 1003
        const name = isDefault ? "default" : pickName(stmt);
        if (!name) {
          pushScoped(
            {
              name: `${prefix}default`,
              note: "anonymous default function is not projected",
              kind: "other",
            },
            ambient,
          );
          continue;
        }
        fnDecl(stmt, `${prefix}${name}`, ambient);
        continue;
      }
      if (ts.isVariableStatement(stmt)) {
        if (!isExported(stmt)) continue;
        for (const d of stmt.declarationList.declarations) {
          const name = pickName(d);
          if (!name) continue;
          const t = typeToDsl(d.type, ctx);
          if (!t) {
            pushScoped(
              {
                name: `${prefix}${name}`,
                note: "no type annotation — the value is not projected",
                kind: "value",
              },
              ambient,
            );
            continue;
          }
          pushScoped(
            {
              name: `${prefix}${name}`,
              dsl: constraintSlot(t),
              kind: t.dsl.startsWith("fn(") ? "function" : "value",
              ...(t.modeled ? {} : { partial: true }),
            },
            ambient,
          );
        }
        continue;
      }
      if (ts.isClassDeclaration(stmt)) {
        if (!isExported(stmt) && !isDefaultExported(stmt)) continue;
        const name = isDefaultExported(stmt) ? "default" : pickName(stmt);
        if (!name) {
          pushScoped(
            { name: `${prefix}default`, note: "anonymous class is not projected", kind: "class" },
            ambient,
          );
          continue;
        }
        // **构造器签名**（类值的「调用形状」）——此前**整条消失** ⇒
        // `new Thing(…)` 零义务（且汇总行还报「0 skipped」⇒ 丢失零信号）。
        // 收割面把类值建成**构造器 fn**（ctor facet + 构造器形参表）⇒
        // 草稿面同款：投影构造器的形参表（实例侧 DSL 无从表达 ⇒ 如实标注）。
        const ctor = stmt.members.find(ts.isConstructorDeclaration);
        if (ctor) {
          const slots = paramSlots(ctor.parameters, ctx);
          pushScoped(
            {
              name: `${prefix}${name}`,
              dsl: `fn(${slotsToDsl(slots)}, any())`,
              kind: "class",
              note: "constructor signature projected as a plain fn — the contract DSL has no `new` semantics, and the instance side is not modeled",
              partial: true,
            },
            ambient,
          );
        }
        let anyMethod = false;
        for (const m of stmt.members) {
          if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) {
            const mname = pickName(m);
            if (!mname) continue;
            anyMethod = true;
            const d = fnSignatureDsl(m.parameters, (m as ts.MethodDeclaration).type, ctx);
            pushScoped(
              {
                name: `${prefix}${name}.${mname}`,
                dsl: d.dsl,
                kind: "function",
                ...(d.modeled ? {} : { partial: true }),
              },
              ambient,
            );
          }
        }
        if (!anyMethod && !ctor) {
          pushScoped(
            {
              name: `${prefix}${name}`,
              note: "class without public methods projected",
              kind: "class",
            },
            ambient,
          );
        }
        continue;
      }
      if (ts.isEnumDeclaration(stmt)) {
        // enum 是**运行时导出**（收割面看得见）⇒ 必须进草稿——Bug 960
        if (!isExported(stmt) && !isDefaultExported(stmt)) continue;
        const name = isDefaultExported(stmt) ? "default" : pickName(stmt);
        if (!name) {
          pushScoped(
            { name: `${prefix}enum`, note: "anonymous enum is not projected", kind: "other" },
            ambient,
          );
          continue;
        }
        const dsl = enumShape(stmt, ctx);
        pushScoped({ name: `${prefix}${name}`, dsl, kind: "value" }, ambient);
        continue;
      }
      if (ts.isModuleDeclaration(stmt)) {
        // **ambient 模块**（`declare module "x" { … }`）——此前**整块不遍历**
        // ⇒ 内部导出既不可见也不计数（汇总行说谎）。收割面把模块体登记在
        // 该模块的 scope 下 ⇒ 草稿面同款：遍历模块体，导出名带模块前缀。
        if (ts.isStringLiteral(stmt.name)) {
          const modName = stmt.name.text;
          if (!stmt.body || !ts.isModuleBlock(stmt.body)) {
            pushScoped(
              {
                name: `${prefix}${modName}`,
                note: "ambient module without a body is not projected",
                kind: "other",
              },
              ambient,
            );
            continue;
          }
          collectStatements(
            stmt.body.statements,
            `${prefix}${modName}.`,
            `ambient module "${modName}" — not an export of this file (review before accepting)`,
          );
          continue;
        }
        // `declare global { … }`：**不是**命名空间（TS 侧是全局作用域）⇒
        // 成员同样不是本文件的导出 ⇒ 按 ambient 块处理（可见 + 计数）。
        if (ts.isIdentifier(stmt.name) && stmt.name.text === "global") {
          if (!stmt.body || !ts.isModuleBlock(stmt.body)) {
            pushScoped(
              { name: `${prefix}global`, note: "ambient global without a body", kind: "other" },
              ambient,
            );
            continue;
          }
          collectStatements(
            stmt.body.statements,
            `${prefix}global.`,
            `ambient global declaration — not an export of this file (review before accepting)`,
          );
          continue;
        }
        // namespace 是**运行时导出** ⇒ 必须进草稿——Bug 960
        if (!isExported(stmt) && !isDefaultExported(stmt)) continue;
        const name = isDefaultExported(stmt) ? "default" : pickName(stmt);
        if (!name) {
          pushScoped(
            { name: `${prefix}namespace`, note: "anonymous namespace is not projected", kind: "other" },
            ambient,
          );
          continue;
        }
        if (!stmt.body || !ts.isModuleBlock(stmt.body)) {
          pushScoped(
            {
              name: `${prefix}${name}`,
              note: "namespace with a qualified name is not projected",
              kind: "other",
            },
            ambient,
          );
          continue;
        }
        const fields: string[] = [];
        for (const inner of stmt.body.statements) {
          const f = namespaceMemberField(inner, ctx);
          if (f) fields.push(f);
        }
        pushScoped(
          {
            name: `${prefix}${name}`,
            dsl: fields.length > 0 ? `shape({ ${fields.join(", ")} })` : "shape({})",
            kind: "value",
          },
          ambient,
        );
        continue;
      }
      if (ts.isExportDeclaration(stmt)) {
        // export { x } from "m" / export * from "m" / export { x as y }
        const spec = stmt.moduleSpecifier?.getText(sourceFile);
        if (!stmt.exportClause) {
          pushScoped(
            {
              name: spec ? `export * from ${spec}` : "export *",
              note: "star re-export — the exported names are unknown, so nothing is projected",
              kind: "other",
            },
            ambient,
          );
          continue;
        }
        if (ts.isNamespaceExport(stmt.exportClause)) {
          pushScoped(
            {
              name: `${prefix}${stmt.exportClause.name.text}`,
              note: `namespace re-export${spec ? ` from ${spec}` : ""} is not projected`,
              kind: "other",
            },
            ambient,
          );
          continue;
        }
        for (const el of stmt.exportClause.elements) {
          const exported = el.name.text;
          if (spec) {
            pushScoped(
              {
                name: `${prefix}${exported}`,
                note: `re-export from ${spec} is not projected`,
                kind: "other",
              },
              ambient,
            );
            continue;
          }
          // 本地再导出 ⇒ 解析同文件的本地声明
          const localName = el.propertyName?.text ?? el.name.text;
          const local = locals.get(localName);
          if (!local) {
            pushScoped(
              {
                name: `${prefix}${exported}`,
                note: `local re-export of '${localName}' — the local declaration was not found`,
                kind: "other",
              },
              ambient,
            );
            continue;
          }
          const projected = projectLocal(local, localName, exported, ctx);
          pushScoped({ ...projected, name: `${prefix}${projected.name}` }, ambient);
        }
        continue;
      }
      if (ts.isExportAssignment(stmt)) {
        // export = / export default expr
        pushScoped(
          {
            name: `${prefix}default`,
            note: "export assignment — bind via sidecar default",
            kind: "other",
          },
          ambient,
        );
        continue;
      }
      if (ts.isImportEqualsDeclaration(stmt)) {
        // `export import x = require("m")`（CJS 形态的运行时导出）
        // —— 旧实现**整条静默丢弃** ⇒ 汇总行看不出丢失（Bug 960 同族）
        if (!isExported(stmt)) continue;
        const name = pickName(stmt);
        pushScoped(
          {
            name: `${prefix}${name ?? "import="}`,
            note: "import-equals export — the aliased module value is not projected",
            kind: "other",
          },
          ambient,
        );
        continue;
      }
      if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
        // 类型不是运行时契约；跳过（但进符号表）
        continue;
      }
    }
  };

  collectStatements(sourceFile.statements, "", undefined);

  // 重载组：合并成一条（全部 overload 的返回类型都保留）
  for (const [name, group] of fnGroups) {
    if (emittedFns.has(name)) continue;
    emittedFns.add(name);
    const decls = group.decls;
    const m = mergeOverloads(decls, ctx);
    if (decls.length > 1) {
      // 被合并掉的 overload **如实计数**（汇总行是契约的一部分）——Bug 825
      ctx.lost.n += decls.length - 1;
    }
    // 形参口径必须**写明**：按位合并（与收割面同口径）／还是取首个（窄口径）
    const paramNote = m.paramsMerged
      ? "parameters merged position by position (union per position)"
      : m.arityDiffers
        ? `parameters from the first (arity ${m.arity} — calls with more arguments are not covered; the contract DSL has no overload set)`
        : "parameters from the first (the overload parameter types could not be merged)";
    pushScoped(
      {
        name,
        dsl: m.dsl.dsl,
        kind: "function",
        ...(decls.length > 1
          ? {
              note: `${decls.length} overloads merged — ${paramNote}, return = union of all; overloads: ${m.sigs.join(" | ")}`,
            }
          : {}),
        ...(m.dsl.modeled ? {} : { partial: true }),
      },
      group.ambient,
    );
  }

  return { exports: out, lost: ctx.lost.n };
}

/** 本地再导出（`export { local as exported }`）⇒ 投影本地声明 */
function projectLocal(
  stmt: ts.Statement,
  localName: string,
  exported: string,
  ctx: DraftCtx,
): DtsExportDraft {
  if (ts.isFunctionDeclaration(stmt)) {
    const d = fnSignatureDsl(stmt.parameters, stmt.type, ctx);
    return {
      name: exported,
      dsl: d.dsl,
      kind: "function",
      ...(d.modeled ? {} : { partial: true }),
    };
  }
  if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (pickName(decl) !== localName) continue;
      const t = typeToDsl(decl.type, ctx);
      if (!t) {
        return {
          name: exported,
          note: "no type annotation — the value is not projected",
          kind: "value",
        };
      }
      return {
        name: exported,
        dsl: constraintSlot(t),
        kind: t.dsl.startsWith("fn(") ? "function" : "value",
        ...(t.modeled ? {} : { partial: true }),
      };
    }
  }
  if (ts.isEnumDeclaration(stmt)) {
    return { name: exported, dsl: enumShape(stmt, ctx), kind: "value" };
  }
  if (ts.isClassDeclaration(stmt)) {
    return {
      name: exported,
      note: "class re-export is not projected",
      kind: "class",
    };
  }
  return {
    name: exported,
    note: `local re-export of '${localName}' is not projected`,
    kind: "other",
  };
}

/**
 * 草稿侧车键 = **导出名**（dts 导出名即契约身份）。
 * `Class.method` → `Class_method`（C4.2 侧车键）。
 */
function draftIdentity(name: string): string {
  return name.includes(".") ? toJsBindingIdent(name.replace(/\./g, "_")) : name;
}

/**
 * 草稿模块内的**绑定名**：身份本身可作绑定时直接用；否则（保留字 / 非 ident /
 * 与 builder import 撞名）走别名 `_default` / `_nudo_<n>`——身份仍是导出名。
 * （service/emit/export-binding.ts 有同形实现；harvester 不依赖 service，此处复刻。）
 */
function draftBindingName(identity: string, taken: (name: string) => boolean): string {
  if (isJsBindingIdent(identity) && !taken(identity)) return identity;
  const alias = toJsBindingIdent(identity);
  if (isJsBindingIdent(alias) && !taken(alias)) return alias;
  let n = 1;
  while (taken(`_nudo_${n}`)) n++;
  return `_nudo_${n}`;
}

/** export 子句里的导出名表示：IdentifierName 裸写，否则 JSON 引号串 */
function exportNameRepr(name: string): string {
  return /^(?:[$_\p{ID_Start}])(?:[$\u200C\u200D\p{ID_Continue}])*$/u.test(name)
    ? name
    : JSON.stringify(name);
}

/** 草稿正文里的导出语句：绑定名可别名，身份恒为导出名 */
function draftExportStmt(binding: string, identity: string, dsl: string): string[] {
  if (binding === identity) return [`export const ${binding} = ${dsl};`];
  return [`const ${binding} = ${dsl};`, `export { ${binding} as ${exportNameRepr(identity)} };`];
}

/** 组装 `@nudo:draft` 模块（与 formatDraftModule 同纪律：不 ambient 绑定）。 */
export function formatDtsContractDraft(
  label: string,
  files: string[],
  exports: DtsExportDraft[],
): string {
  const draftable = exports.filter((e) => e.dsl !== undefined);
  const used = new Set<string>(["fn"]);
  for (const e of draftable) {
    for (const b of BUILDERS) {
      if (new RegExp(`\\b${b}\\b`).test(e.dsl!)) used.add(b);
    }
  }
  // any() 也要
  if (draftable.some((e) => /\bany\s*\(/.test(e.dsl!))) used.add("any");
  const importList = BUILDERS.filter((b) => used.has(b)).join(", ");
  const importNames = new Set<string>(used);
  const exportUsed = new Set<string>();

  const lines: string[] = [
    "// @nudo:draft",
    `// Generated by \`nudo contract --from-dts\` from ${label}`,
    `// Sources: ${files.map((f) => basename(f)).join(", ")}`,
    "//",
    "// Reverse-engineered from TypeScript declarations — NOT a sidecar contract.",
    "// This file is never loaded for check. Review each export, then copy it",
    "// into <target>.nudo.js to accept (that is when obligations go live).",
    "//",
    "// After accept: strengthen with Pred builders (number().gt(0) …) —",
    "// dts cannot express algebraic implications (x>0 ⇒ x+1>1).",
    "",
    `import { ${importList} } from "@nudojs/core";`,
    "",
  ];

  if (draftable.length === 0) {
    lines.push("// (no projectable exports)");
    lines.push("");
  }

  for (const e of exports) {
    if (e.dsl === undefined) {
      lines.push(`// ${e.name} — skipped (${e.note ?? "unmodeled"})`);
      continue;
    }
    if (e.note) lines.push(`// ${e.name} — ${e.note}`);
    else lines.push(`// ${e.name} — from TypeScript`);
    // 身份 = 导出名；绑定名撞 builder import（`export const number` vs
    // `import { number }` ⇒ 解析期 SyntaxError）时走别名形态
    const identity = draftIdentity(e.name);
    const binding = draftBindingName(identity, (n) => importNames.has(n) || exportUsed.has(n));
    exportUsed.add(binding);
    for (const stmt of draftExportStmt(binding, identity, e.dsl)) {
      lines.push(stmt);
    }
    if (e.name.includes(".")) {
      lines.push(`//   sidecar key may also be written as \`${e.name}\``);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * 目录遍历的**深度上限**（symlink 环保护）；超出的子树**如实计数**
 * （不能静默丢——汇总行是契约的一部分）。
 */
const MAX_WALK_DEPTH = 6;

/** 目录模式的扫描结果 */
type DtsScan = {
  files: string[];
  /** **没能遍历**的目录 / 条目数（读失败 / 深度上限） */
  droppedDirs: number;
};

/**
 * 目录模式：收集入口下的**全部** `.d.ts`。
 *
 * **不设投影条数上限**（Bug 1015：旧实现静默只投影前 16 个 `.d.ts` ⇒
 * 第 17+ 个文件的导出整条不存在、汇总行还报「16 d.ts · 0 skipped」）。
 * 遍历不到的地方（读失败 / 深度上限）**如实计数** ⇒ 汇总行说真话。
 */
function readDtsFiles(paths: string[]): DtsScan {
  const found: string[] = [];
  let droppedDirs = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH) {
      // 深度上限 ⇒ 该子树没被遍历 ⇒ 计数（里面的 .d.ts 数量未知）
      droppedDirs++;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      droppedDirs++;
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === "test" || name === "__tests__") continue;
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        // 条目 stat 失败（断链 / 权限）⇒ 我们不知道它是什么 ⇒ 计数
        droppedDirs++;
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (name.endsWith(".d.ts") && !name.endsWith(".d.ts.map")) {
        found.push(p);
      }
    }
  };
  for (const p of paths) {
    // 顶层入口单次 stat（walker 内部有 try，顶层此前没有）：不存在
    // （ENOENT/ENOTDIR）按无入口处理；EACCES/EIO 等真实读故障上抛——
    // harvester CLI 面有顶层 catch 收口，静默吞掉会让入口树无声缺文件。
    const st = statSync(p, { throwIfNoEntry: false });
    if (st === undefined) continue;
    if (st.isDirectory()) walk(p, 0);
    else if (/\.d\.ts$/.test(p) || /\.(m)?ts$/.test(p)) {
      if (!p.endsWith(".d.ts.map")) found.push(p);
    }
  }
  // 顺序确定（与收割面 harvest-package.ts 同口径）——不依赖 readdir 顺序
  found.sort();
  return { files: found, droppedDirs };
}

/**
 * 从 .d.ts 路径列表生成契约草稿（不写盘）。
 * `label` 用于头注释（包名或描述）。
 */
export function dtsToContractDraft(
  dtsFiles: string[],
  label?: string,
): DtsContractDraft {
  const files = dtsFiles.filter((f) => existsSync(f));
  const exports: DtsExportDraft[] = [];
  let skippedFiles = 0;
  let droppedEntries = 0;
  let lostEntries = 0;
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      skippedFiles++;
      continue;
    }
    const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const collected = collectExports(sf);
    // 声明数 − 条目数（被合并的 overload 等）⇒ 计入 skipped
    lostEntries += collected.lost;
    for (const e of collected.exports) {
      // 去重：同名取先（**被丢的条目计入 skipped** —— 汇总行必须说真话）
      if (exports.some((x) => x.name === e.name && x.dsl)) {
        droppedEntries++;
        continue;
      }
      exports.push(e);
    }
  }
  const name = label ?? (files[0] ? basename(files[0]).replace(/\.d\.ts$/, "") : "dts");
  const draftSource = formatDtsContractDraft(name, files, exports);
  const unprojected = exports.filter((e) => e.dsl === undefined).length;
  const partial = exports.filter((e) => e.partial && e.dsl !== undefined).length;
  return {
    label: name,
    files,
    exports,
    draftSource,
    stats: {
      files: files.length - skippedFiles,
      exports: exports.filter((e) => e.dsl !== undefined).length,
      // skipped = 丢失的条数（整条没投影 + 投影了但有未建模部分 + 读失败 +
      // 同名去重丢掉的 + 声明被合并掉的）——汇总行报「0 skipped」的前提是
      // **真的**没丢东西
      skipped: unprojected + partial + skippedFiles + droppedEntries + lostEntries,
    },
  };
}

/** 目录/文件入口：内部解析 .d.ts 列表。 */
export function dtsPathToContractDraft(
  path: string,
  label?: string,
): DtsContractDraft {
  const scan = readDtsFiles([path]);
  const draft = dtsToContractDraft(scan.files, label ?? basename(path).replace(/\.d\.ts$/, ""));
  if (scan.droppedDirs > 0) {
    // 遍历不到的地方**如实计数**（否则汇总行会说「没有需要人工处理的东西」）
    draft.stats.skipped += scan.droppedDirs;
    draft.stats.droppedDirs = scan.droppedDirs;
  }
  return draft;
}

export { dirname as dtsDraftDirname };
