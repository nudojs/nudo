/**
 * 源码面初始化器的**值类型推断**。
 *
 * 从 `dts-generator.ts` 抽出：对象字面量逐成员、数组逐元素、函数字面量注解、
 * `new` 泛型实参、`as const` 冻结子树、默认形参类型证据、类字段公开类型。
 * 只映射字面量形状，表达式 / 调用一律 `unknown`（声明面不猜求值结果）。
 */
import type { DtsObjectFnAnnotation } from "./dts-ir.ts";
import { BUILTIN_GENERIC_BRANDS } from "./dts-type.ts";
import { formatPropKey } from "./dts-text.ts";
import {
  nodeAnnotationText,
  safeFieldTypeAnnotation,
  surfaceName,
  surfaceQualifiedName,
  surfaceSlice,
  surfaceSymbolKeyName,
  type SurfaceNode,
} from "./dts-surface-utils.ts";

/**
 * 对象字面量成员函数的源码注解（BUG-157）——只收**静态键**的箭头 / 函数
 * 表达式与方法简写。注解原文在这里不做可解析性判定：采集期 `typeNames` 尚未
 * 收齐（模块级 interface / type 声明在值扫描之后），判定推迟到发射期。
 */
export function objectFnMemberAnnotations(
  init: SurfaceNode | undefined,
  source: string | undefined,
): DtsObjectFnAnnotation[] {
  if (!init || init.type !== "ObjectExpression" || source === undefined) return [];
  const out: DtsObjectFnAnnotation[] = [];
  for (const p of (init.properties as SurfaceNode[] | undefined) ?? []) {
    const isMethod = p.type === "ObjectMethod";
    const v = p.value as SurfaceNode | undefined;
    const isFnProp =
      (p.type === "ObjectProperty" || p.type === "Property") &&
      (v?.type === "FunctionExpression" || v?.type === "ArrowFunctionExpression");
    if (!isMethod && !isFnProp) continue;
    // BUG-236：计算 symbol 键（`[Symbol.iterator]() { … }`）的成员注解同样
    // 要补进 Abs——否则 symbol 成员行只能发 `unknown`，消费方 `[...obj]` 仍
    // 被 TS2488 挡住（可迭代判定要的是迭代器返回类型）。
    const key =
      p.computed === true
        ? surfaceSymbolKeyName(p.key as SurfaceNode | undefined)
        : surfaceName(p.key as SurfaceNode | undefined);
    if (!key) continue;
    const fnNode = (isMethod ? p : v) as SurfaceNode;
    const rawParams = (fnNode.params as SurfaceNode[] | undefined) ?? [];
    const paramTypes = rawParams.map((n) => nodeAnnotationText(n, source));
    const returnType = nodeAnnotationText(fnNode, source);
    if (!paramTypes.some((t) => t !== undefined) && returnType === undefined) continue;
    out.push({
      key,
      paramTypes,
      rest: rawParams.map((n) => n.type === "RestElement"),
      ...(returnType !== undefined ? { returnType } : {}),
    });
  }
  return out;
}

/**
 * BUG-263：对象字面量里**用户符号**计算键的源码名（`{ [tag]: 1 }` ⇒ `["tag"]`）。
 *
 * Abs 的槽键是引擎内部 id（`@@sym#N`），没有到源码绑定名的反查通道；按
 * 属性出现序收集即可与 Abs 槽序一一对应（well-known symbol 由既有映射处理，
 * 不参与本表）。嵌套对象递归展开，保证渲染顺序一致。
 */
export function userSymbolMemberKeys(init: SurfaceNode | undefined): string[] {
  if (!init || init.type !== "ObjectExpression") return [];
  const out: string[] = [];
  for (const p of (init.properties as SurfaceNode[] | undefined) ?? []) {
    const key = p.key as SurfaceNode | undefined;
    if (p.computed === true && key?.type === "Identifier" && typeof key.name === "string") {
      out.push(key.name);
    }
    const v = p.value as SurfaceNode | undefined;
    if (v?.type === "ObjectExpression") out.push(...userSymbolMemberKeys(v));
  }
  return out;
}

/**
 * 初始化器形状 → TS 类型串（Bug 62 的 CJS 值导出 / default 表达式兜底）。
 * 比 `classFieldTypeOfInit` 完整：对象逐成员投影、数组按元素 join ⇒ 消费端
 * `import { obj, arr }` 拿到的不是 `object` / `unknown[]` 这种会 TS2322 的
 * 宽类型。只映射字面量形状，表达式一律 unknown（声明面不猜求值结果）。
 */
export function valueTypeTextOfInit(
  init: SurfaceNode | undefined,
  source?: string,
  isKnownValue?: (name: string) => boolean,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
): string {
  if (!init) return "unknown";
  if (init.type === "ObjectExpression") {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const p of (init.properties as SurfaceNode[] | undefined) ?? []) {
      if (
        p.type !== "ObjectProperty" &&
        p.type !== "Property" &&
        p.type !== "ObjectMethod"
      ) {
        continue;
      }
      const computed = p.computed === true;
      const keyName = computed
        ? surfaceSymbolKeyName(p.key as SurfaceNode | undefined) ??
          surfaceName(p.key as SurfaceNode | undefined)
        : surfaceName(p.key as SurfaceNode | undefined);
      if (!keyName) continue;
      const k = computed ? `[${keyName}]` : keyName;
      if (seen.has(k)) continue;
      seen.add(k);
      // BUG-355：ObjectMethod 的 `value` 在 Babel AST 上是 undefined——直接
      // 当属性值读会得到 `unknown`。方法节点本身就是签名来源。
      if (p.type === "ObjectMethod") {
        const kind = String(p.kind ?? "method");
        if (kind === "get") {
          const ret =
            safeFieldTypeAnnotation(nodeAnnotationText(p, source), isResolvable) ?? "unknown";
          parts.push(`${k}: ${ret}`);
          continue;
        }
        if (kind === "set") {
          const params = (p.params as SurfaceNode[] | undefined) ?? [];
          const ann =
            safeFieldTypeAnnotation(nodeAnnotationText(params[0], source), isResolvable) ??
            "unknown";
          parts.push(`${k}: ${ann}`);
          continue;
        }
        parts.push(`${k}: ${functionLiteralTypeText(p, source, isResolvable)}`);
        continue;
      }
      const v = (p.value ?? undefined) as SurfaceNode | undefined;
      parts.push(
        `${k}: ${v ? valueTypeTextOfInit(v, source, isKnownValue, isResolvable) : "unknown"}`,
      );
    }
    return parts.length > 0 ? `{ ${parts.join("; ")} }` : "object";
  }
  if (init.type === "ArrayExpression") {
    const elems = ((init.elements as SurfaceNode[] | undefined) ?? []).filter(
      (e): e is SurfaceNode => !!e,
    );
    const types = [
      ...new Set(elems.map((e) => valueTypeTextOfInit(e, source, isKnownValue, isResolvable))),
    ];
    if (types.length === 0) return "unknown[]";
    return types.length === 1 ? `${types[0]}[]` : `(${types.join(" | ")})[]`;
  }
  // BUG-258：`export const alias = target` / `{ fn: target }` 的类型是
  // `typeof target`（引用声明的 TS 签名），不是合作过的 `() => unknown`。
  if (init.type === "Identifier") {
    const name = surfaceName(init);
    if (name === "undefined") return "undefined";
    if (name && isKnownValue?.(name) === true) return `typeof ${name}`;
    return "unknown";
  }
  if (init.type === "NewExpression") {
    return newExpressionTypeText(init, source);
  }
  return classFieldTypeOfInit(init, source, isResolvable);
}

/**
 * 函数字面量 → TS 函数类型（BUG-356）：保留源码形参 / 返回注解。
 *
 * 旧实现的类字段分支硬编码 `(a0: unknown) => unknown` —— 注解就在 AST 上却
 * 从不读取；同一注解在具名对象字面量通道是正确的。
 */
export function functionLiteralTypeText(
  fnNode: SurfaceNode,
  source: string | undefined,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
): string {
  const params = Array.isArray(fnNode.params) ? (fnNode.params as SurfaceNode[]) : [];
  const slots = params.map((p, i) => {
    if (p.type === "RestElement") {
      const arg = p.argument as SurfaceNode | undefined;
      const name = surfaceName(arg) ?? `args${i}`;
      const ann = safeFieldTypeAnnotation(nodeAnnotationText(arg, source), isResolvable);
      return `...${name}${ann ? `: ${ann}` : ": unknown[]"}`;
    }
    if (p.type === "AssignmentPattern") {
      const left = p.left as SurfaceNode | undefined;
      const name = surfaceName(left) ?? `arg${i}`;
      const ann = safeFieldTypeAnnotation(nodeAnnotationText(left, source), isResolvable);
      const fallback = valueTypeTextOfInit(
        p.right as SurfaceNode | undefined,
        source,
        undefined,
        isResolvable,
      );
      return `${name}?${ann ? `: ${ann}` : fallback === "unknown" ? "" : `: ${fallback}`}`;
    }
    if (p.type === "Identifier") {
      const name = surfaceName(p) ?? `arg${i}`;
      const ann = safeFieldTypeAnnotation(nodeAnnotationText(p, source), isResolvable);
      const opt = p.optional === true ? "?" : "";
      return `${name}${opt}${ann ? `: ${ann}` : ": unknown"}`;
    }
    return `arg${i}: unknown`;
  });
  const ret =
    safeFieldTypeAnnotation(nodeAnnotationText(fnNode, source), isResolvable) ??
    (fnNode.async === true ? "Promise<unknown>" : "unknown");
  return `(${slots.join(", ")}) => ${ret}`;
}

/** `new X<…>()` → `X<…>`（内建泛型缺实参时补占位，避免 TS2314，BUG-254）。 */
export function newExpressionTypeText(init: SurfaceNode, source?: string): string {
  const callee = surfaceQualifiedName(init.callee as SurfaceNode | undefined);
  if (!callee) return "object";
  const params =
    ((init.typeArguments as { params?: SurfaceNode[] } | undefined)?.params ?? []);
  const args = (source === undefined ? [] : params.map((p) => surfaceSlice(source, p)))
    .filter((t): t is string => t !== undefined && t.length > 0);
  if (args.length > 0) return `${callee}<${args.join(", ")}>`;
  return BUILTIN_GENERIC_BRANDS.get(callee) ?? callee;
}

/** `as const` / `<const>` 断言节点 */
export function isConstAssertionNode(node: SurfaceNode | undefined): boolean {
  if (!node) return false;
  if (node.type !== "TSAsExpression" && node.type !== "TSTypeAssertion") return false;
  const ann = node.typeAnnotation as SurfaceNode | undefined;
  return (
    ann?.type === "TSTypeReference" &&
    surfaceName(ann.typeName as SurfaceNode | undefined) === "const"
  );
}

/** 初始化器**内部**（任意深度）是否有 `as const` 断言 */
export function containsConstAssertion(node: SurfaceNode | undefined): boolean {
  if (!node || typeof node !== "object") return false;
  if (isConstAssertionNode(node)) return true;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      if (
        value.some(
          (v) => v !== null && typeof v === "object" && containsConstAssertion(v as SurfaceNode),
        )
      ) {
        return true;
      }
      continue;
    }
    if (value !== null && typeof value === "object" && containsConstAssertion(value as SurfaceNode)) {
      return true;
    }
  }
  return false;
}

/**
 * `as const` 冻结子树 → TS 字面量类型（与 `tsc --declaration` 同口径）。
 *
 * `as const` 的操作数受 TS 限制（只允许字面量表达式），所以按 AST 渲染是
 * 可靠的、不需要求值：字面量保精度、对象逐槽 `readonly`、数组成
 * `readonly [ … ]`。
 */
export function frozenLiteralType(node: SurfaceNode | undefined): string {
  if (!node) return "unknown";
  switch (node.type) {
    case "StringLiteral":
      return typeof node.value === "string" ? JSON.stringify(node.value) : "string";
    case "NumericLiteral":
      return typeof node.value === "number" ? String(node.value) : "number";
    case "BooleanLiteral":
      return node.value === true ? "true" : "false";
    case "NullLiteral":
      return "null";
    case "BigIntLiteral":
      return typeof node.value === "string" ? `${node.value}n` : "bigint";
    case "Identifier":
      // `undefined` 是唯一合法的标识符操作数；其余（不该出现）不猜，避免把
      // 一个产品里没有声明的名字写进 `.d.ts`（TS2304）。
      return node.name === "undefined" ? "undefined" : "unknown";
    case "UnaryExpression": {
      const arg = node.argument as SurfaceNode | undefined;
      if (
        (node.operator === "-" || node.operator === "+") &&
        arg?.type === "NumericLiteral" &&
        typeof arg.value === "number"
      ) {
        return node.operator === "-" ? `-${arg.value}` : String(arg.value);
      }
      return "unknown";
    }
    case "TemplateLiteral": {
      const quasis = (node.quasis as SurfaceNode[] | undefined) ?? [];
      const exprs = (node.expressions as SurfaceNode[] | undefined) ?? [];
      if (exprs.length > 0) return "string";
      const raw = quasis
        .map((q) => String((q.value as { raw?: string } | undefined)?.raw ?? ""))
        .join("");
      return `\`${raw}\``;
    }
    case "ObjectExpression": {
      const entries: string[] = [];
      for (const p of (node.properties as SurfaceNode[] | undefined) ?? []) {
        if (p.type !== "ObjectProperty" && p.type !== "Property") continue;
        if (p.computed === true) continue;
        const k = surfaceName(p.key as SurfaceNode | undefined);
        if (!k) continue;
        entries.push(
          `readonly ${formatPropKey(k)}: ${frozenLiteralType(p.value as SurfaceNode | undefined)}`,
        );
      }
      return entries.length === 0 ? "Record<string, never>" : `{ ${entries.join("; ")} }`;
    }
    case "ArrayExpression": {
      const elems = ((node.elements as SurfaceNode[] | undefined) ?? []).filter(
        (e): e is SurfaceNode => e !== null && e !== undefined,
      );
      return `readonly [${elems.map(frozenLiteralType).join(", ")}]`;
    }
    default:
      return "unknown";
  }
}

/** 数组元素位：联合 / 带空格的类型要加括号（`(readonly [1, 2])[]`） */
function wrapArrayElementType(t: string): string {
  return /^readonly\s|\s\|\s|&/.test(t) ? `(${t})` : t;
}

/**
 * 初始化器类型（BUG-140 的嵌套 `as const` 档）：逐层按「该子树是否冻结」投影。
 *
 * `nested = { x: [1, 2] as const }` 的绑定本身不是 `as const`（对象未冻结）
 * ⇒ 外层属性不是 `readonly`，内层数组是 `readonly [1, 2]`。只有这种「外层
 * 可变、内层冻结」的形态需要走这里；顶层 `as const` 仍走既有只读通道。
 *
 * **拿不准就不投影**（返回 undefined ⇒ 调用方回落到分析面的观测 Abs）：
 * 展开 / 计算键 / 方法 / 访问器 / 数组展开这些形态按源码逐槽枚举会**丢键**
 * 或把元素域算错（旧实现静默跳过 ⇒ `{ ["a"]: [1, 2] as const }` 变成
 * `Record<string, never>`、`{ ...base, … }` 丢掉 `b`、getter 丢掉 `g`）。
 */
export function constAwareValueType(
  node: SurfaceNode | undefined,
  source?: string,
): string | undefined {
  if (!node) return undefined;
  if (isConstAssertionNode(node)) return frozenLiteralType(node.expression as SurfaceNode | undefined);
  if (node.type === "ObjectExpression") {
    const parts: string[] = [];
    for (const p of (node.properties as SurfaceNode[] | undefined) ?? []) {
      // 展开 / 方法 / getter / setter：不是「静态可枚举的数据属性」
      if (p.type !== "ObjectProperty" && p.type !== "Property") return undefined;
      if (typeof p.kind === "string" && p.kind !== "init") return undefined;
      if (p.computed === true) return undefined;
      const k = surfaceName(p.key as SurfaceNode | undefined);
      if (!k) return undefined;
      const v = constAwareValueType(p.value as SurfaceNode | undefined, source);
      if (v === undefined) return undefined;
      parts.push(`${formatPropKey(k)}: ${v}`);
    }
    return parts.length === 0 ? "Record<string, never>" : `{ ${parts.join("; ")} }`;
  }
  if (node.type === "ArrayExpression") {
    const raw = (node.elements as Array<SurfaceNode | null> | undefined) ?? [];
    // 空洞 / 展开：元素域无法按源码列点确定
    if (raw.some((e) => e === null || e === undefined || e.type === "SpreadElement")) {
      return undefined;
    }
    const types: string[] = [];
    for (const e of raw as SurfaceNode[]) {
      const t = constAwareValueType(e, source);
      if (t === undefined) return undefined;
      if (!types.includes(t)) types.push(t);
    }
    if (types.length === 0) return "unknown[]";
    const wrapped = types.map(wrapArrayElementType);
    return wrapped.length === 1 ? `${wrapped[0]}[]` : `(${wrapped.join(" | ")})[]`;
  }
  return valueTypeTextOfInit(node);
}

/** 形参名列表（Identifier / RestElement / AssignmentPattern / 模式 → argN） */
export function surfaceParamNames(params: SurfaceNode[] | undefined): string[] {
  return (params ?? []).map((p, i) => {
    if (p.type === "Identifier" && typeof p.name === "string") {
      // BUG-122：TS 可选形参 `n?: number` 的 `?` 挂在 Identifier 上
      // （`optional: true`），不是 AssignmentPattern ⇒ 旧实现丢标记，
      // 消费方 `new C()` 报 TS2554。
      return p.optional === true ? `${p.name}?` : p.name;
    }
    if (p.type === "RestElement") {
      const arg = p.argument as SurfaceNode | undefined;
      const n = surfaceName(arg);
      return n ? `...${n}` : `...arg${i}`;
    }
    if (p.type === "AssignmentPattern") {
      // Bug 71：带默认值的形参是**声明级**可省。`paramDeclOf` 经
      // `sanitizeParamName` 会保留尾随 `?`（`x?` → `x?: unknown`），否则构造器 /
      // static 方法的默认值信息在采集期就丢了 ⇒ 消费端 `new C()` / `C.make()`
      // 报 TS2554。
      const n = surfaceName(p.left as SurfaceNode | undefined);
      return `${n ?? `arg${i}`}?`;
    }
    if (p.type === "TSParameterProperty") {
      const inner = p.parameter as SurfaceNode | undefined;
      const n = inner ? surfaceParamNames([inner])[0] : undefined;
      return n ?? `arg${i}`;
    }
    return `arg${i}`;
  });
}

/**
 * BUG-193：形参默认值 → 类型证据（TS 声明面同口径）。
 *
 * `function f(x = 1)` 在 tsc `--declaration` 里是 `f(x?: number)`：默认值
 * **初始值**是类型证据。分析面入口 Abs 不携带默认值（`f()` 的 entry@ 实参
 * 是 any）⇒ dts 形参位曾落 `unknown`。这里从源码 `AssignmentPattern` 的
 * 初始值静态定型（只收字面量形状；标识符 / 调用一律不猜），按位返回。
 *
 * 显式注解位不采集（`tsParamAnnotation` 是更高一档证据）；无任何证据时返回
 * undefined（调用方沿用既有回落）。
 */
export function defaultParamTypeTexts(
  params: SurfaceNode[] | undefined,
  source: string | undefined,
): Array<string | undefined> | undefined {
  if (!params || params.length === 0 || source === undefined) return undefined;
  // 与 `extractFormals` 的形参表同口径：`this: T` 是接收者标注，不占形参位。
  const formals = params.filter(
    (p) => !(p?.type === "Identifier" && p.name === "this"),
  );
  let any = false;
  const out = formals.map((p) => {
    const t = defaultParamTypeTextOf(p, source);
    if (t !== undefined) any = true;
    return t;
  });
  return any ? out : undefined;
}

/** 单个形参默认值的静态类型（无证据 ⇒ undefined；见 `defaultParamTypeTexts`） */
export function defaultParamTypeTextOf(
  p: SurfaceNode | undefined,
  source: string | undefined,
): string | undefined {
  if (!p || source === undefined) return undefined;
  if (p.type === "TSParameterProperty") {
    return defaultParamTypeTextOf(p.parameter as SurfaceNode | undefined, source);
  }
  if (p.type !== "AssignmentPattern") return undefined;
  const left = p.left as SurfaceNode | undefined;
  if (left?.type !== "Identifier") return undefined;
  // 显式注解优先（这里只补「无注解」的默认形参位）
  if (nodeAnnotationText(left, source) !== undefined) return undefined;
  const text = valueTypeTextOfInit(p.right as SurfaceNode | undefined, source);
  return text === "unknown" ? undefined : text;
}

/** 类成员节点 → 其函数节点（estree MethodDefinition.value / Babel ClassMethod） */
export function surfaceMemberFn(member: SurfaceNode): SurfaceNode {
  if (member.type === "MethodDefinition") {
    return (member.value as SurfaceNode | undefined) ?? member;
  }
  return member;
}

/**
 * 类字段公开类型 = **唯一优先级格**（ADR §4 D2）：声明 > 观测。
 *
 * - `declared`：源码类型注解。mutable 字段的公开类型**不得窄于**注解——
 *   `z: number | null = 1` 若发射成 `number`，消费方按注解写 `null` 就 TS2322
 *   （BUG-014）。这是不可靠的说法：注解允许的值，产物必须允许。
 * - `observed`：初始化器形状（无注解时才用；仍不猜表达式）。
 * - 否则 `unknown`（不是「无类型」，是「未观测到」）。
 */
export function classFieldType(
  init: SurfaceNode | undefined,
  annotation?: string,
  source?: string,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
  readonly = false,
): string {
  if (annotation !== undefined) return annotation;
  return classFieldTypeOfInit(init, source, isResolvable, readonly);
}

/** 初始化器形状 → 基类型（供 `classFieldType` 与 default 表达式投影复用）。 */
export function classFieldTypeOfInit(
  init: SurfaceNode | undefined,
  source?: string,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
  readonly = false,
): string {
  if (!init) return "unknown";
  // BUG-273：`readonly r = 5` 与 `const r = 5` 同口径——TS 的只读属性**不参与
  // 字面量拓宽**（`new K().r` 的类型是 `5`）。非 readonly 字段仍发 `number`。
  if (
    readonly &&
    (init.type === "NumericLiteral" ||
      init.type === "StringLiteral" ||
      init.type === "BooleanLiteral" ||
      init.type === "BigIntLiteral" ||
      (init.type === "TemplateLiteral" &&
        ((init.expressions as SurfaceNode[] | undefined) ?? []).length === 0))
  ) {
    return frozenLiteralType(init);
  }
  // BUG-135：断言包装不再「一律按内层」——
  // `ro = [1, 2] as const` 会丢掉只读（`unknown[]`）、
  // `x = 1 as number | string` 会被窄化成 `number`（公开面比实现窄 ⇒ 消费方
  // 按源码注解赋值即 TS2322）。`as const` 走冻结字面量通道；`as T` / `<T>`
  // 用可解析的断言原文（`satisfies T` / `v!` 不改变值类型 ⇒ 仍按内层）。
  if (init.type === "TSAsExpression" || init.type === "TSTypeAssertion") {
    const inner = init.expression as SurfaceNode | undefined;
    if (isConstAssertionNode(init)) return frozenLiteralType(inner);
    const asserted =
      source === undefined
        ? undefined
        : surfaceSlice(source, init.typeAnnotation as SurfaceNode | undefined);
    const safe = asserted ? safeFieldTypeAnnotation(asserted, isResolvable) : undefined;
    return safe ?? classFieldTypeOfInit(inner, source, isResolvable);
  }
  if (init.type === "TSNonNullExpression" || init.type === "TSSatisfiesExpression") {
    return classFieldTypeOfInit(init.expression as SurfaceNode | undefined, source, isResolvable);
  }
  switch (init.type) {
    case "NumericLiteral":
      return "number";
    case "StringLiteral":
    case "TemplateLiteral":
      return "string";
    case "BooleanLiteral":
      return "boolean";
    case "ArrayExpression":
    case "ObjectExpression":
      // BUG-244：类字段通道此前只给容器粗型（`unknown[]` / `object`），而模块值
      // 通道早已逐成员投影 ⇒ 同一形状在类字段位不可用。这里复用同一投影。
      return valueTypeTextOfInit(init, source, undefined, isResolvable);
    case "NewExpression":
      // BUG-244 / BUG-254：`new Map<string, number>()` 的类型实参是源码事实。
      return newExpressionTypeText(init, source);
    case "NullLiteral":
      // `state = null` —— TS 对类字段的推断就是 `null`（不是 any/unknown）
      return "null";
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      // BUG-356：保留源码形参 / 返回注解（与具名对象字面量同口径）。
      return functionLiteralTypeText(init, source, isResolvable);
    case "UnaryExpression": {
      // `-1` / `+1`
      const arg = init.argument as SurfaceNode | undefined;
      return arg?.type === "NumericLiteral" ? "number" : "unknown";
    }
    default:
      return "unknown";
  }
}
