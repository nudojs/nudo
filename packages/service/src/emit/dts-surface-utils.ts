/**
 * 源码面（Babel AST）的通用读取工具。
 *
 * 从 `dts-generator.ts` 抽出：节点名、限定名、源码切片、注解原文与可解析性
 * 放行。函数签名投影和模块面扫描共用这些口径，避免同一 AST 事实在两处
 * 解释不同。
 */
import { isRuntimeGlobalCtorName } from "./schema-generator.ts";
import { tsAnnotationTypeText } from "../ts-annotation.ts";
import { WELL_KNOWN_SYMBOLS } from "./dts-type.ts";
import {
  TS_TYPE_TOKENS,
  annotationTypeRefs,
  isTypeRefResolvable,
  typeofValueRefs,
} from "./dts-annotation-text.ts";
import type { DtsModuleSurface } from "./dts-ir.ts";

/** AST 节点最小形状（Babel AST 的鸭子类型——不引 @babel/types） */
export type SurfaceNode = Record<string, unknown> & { type?: string };

/** 标识符名（Identifier / StringLiteral——Babel 的 `export { x as "a-b" }`） */
export function surfaceName(n: SurfaceNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "Identifier" && typeof n.name === "string") return n.name;
  if ((n.type === "StringLiteral" || n.type === "Literal") && typeof n.value === "string") {
    return n.value;
  }
  return undefined;
}

/**
 * Bug 49：`MemberExpression` → 点号限定名（`NS.Base` → `"NS.Base"`）。
 * 只用于**超类子句**（`extends NS.Base`）；`surfaceName` 保持原口径不动，
 * 避免影响导出名 / 成员键 / CJS 检测等其它调用点。
 */
export function surfaceQualifiedName(n: SurfaceNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "MemberExpression" && n.computed !== true) {
    const obj = surfaceQualifiedName(n.object as SurfaceNode | undefined);
    const prop = surfaceName(n.property as SurfaceNode | undefined);
    return obj && prop ? `${obj}.${prop}` : undefined;
  }
  return surfaceName(n);
}

/**
 * BUG-216 / BUG-236：计算键里的 **well-known symbol** → 引擎符号键名
 * （`Symbol.iterator` → `"@@iterator"`）。
 *
 * `Symbol.iterator` 是静态 well-known 名字，不是动态键——TS 有 `[Symbol.x]`
 * 成员语法，漏掉这类键等于把运行期真实存在的公开成员整条删掉。未登记的
 * `Symbol.xxx`（用户符号）TS 没有对应语法 ⇒ 返回 undefined（不猜）。
 */
export function surfaceSymbolKeyName(n: SurfaceNode | undefined): string | undefined {
  if (!n || n.type !== "MemberExpression" || n.computed === true) return undefined;
  const obj = n.object as SurfaceNode | undefined;
  const prop = surfaceName(n.property as SurfaceNode | undefined);
  if (obj?.type !== "Identifier" || obj.name !== "Symbol" || prop === undefined) return undefined;
  const engineKey = `@@${prop}`;
  return WELL_KNOWN_SYMBOLS.has(engineKey) ? engineKey : undefined;
}

/**
 * 变量声明模式里的**全部绑定名**（Bug 63）。`export const { a, b } = src` /
 * `export const [c, ...rest] = arr` 的 `id` 是 ObjectPattern / ArrayPattern，
 * 旧扫描只读 `surfaceName(d.id)`（恒 undefined）⇒ 这些运行时真实存在的导出
 * 在 dts 面整体缺席（消费端 TS2305）。覆盖 Identifier / RestElement /
 * AssignmentPattern / 嵌套模式。
 */
export function patternBindingNames(id: SurfaceNode | undefined): string[] {
  if (!id) return [];
  if (id.type === "Identifier") {
    const n = surfaceName(id);
    return n ? [n] : [];
  }
  const out: string[] = [];
  if (id.type === "ObjectPattern") {
    for (const p of (id.properties as SurfaceNode[] | undefined) ?? []) {
      if (p.type === "RestElement") {
        out.push(...patternBindingNames(p.argument as SurfaceNode | undefined));
        continue;
      }
      out.push(...patternBindingNames((p.value ?? p.argument) as SurfaceNode | undefined));
    }
  } else if (id.type === "ArrayPattern") {
    for (const e of (id.elements as SurfaceNode[] | undefined) ?? []) {
      if (e) out.push(...patternBindingNames(e));
    }
  } else if (id.type === "AssignmentPattern") {
    out.push(...patternBindingNames(id.left as SurfaceNode | undefined));
  } else if (id.type === "RestElement") {
    out.push(...patternBindingNames(id.argument as SurfaceNode | undefined));
  }
  return out;
}

/** 值导出右值是否是函数 / 类（这类走函数声明面，不发值声明） */
export function isFnOrClassInit(n: SurfaceNode | undefined): boolean {
  return (
    n?.type === "FunctionExpression" ||
    n?.type === "ArrowFunctionExpression" ||
    n?.type === "ClassExpression" ||
    n?.type === "ClassDeclaration" ||
    n?.type === "FunctionDeclaration"
  );
}

/** `module.exports` / `exports` → true */
export function isExportsTarget(n: SurfaceNode | undefined): boolean {
  if (!n) return false;
  if (n.type === "Identifier") return n.name === "exports";
  if (n.type === "MemberExpression") {
    return (
      surfaceName(n.object as SurfaceNode | undefined) === "module" &&
      surfaceName(n.property as SurfaceNode | undefined) === "exports"
    );
  }
  return false;
}

/** `exports.a` / `module.exports.a` → "a" */
export function cjsPropName(left: SurfaceNode | undefined): string | undefined {
  if (!left || left.type !== "MemberExpression" || left.computed === true) return undefined;
  if (!isExportsTarget(left.object as SurfaceNode | undefined)) return undefined;
  return surfaceName(left.property as SurfaceNode | undefined);
}

/** 源码片段（`keepTs` 的 AST 上类型注解仍在 ⇒ 直接切原文；越界 ⇒ undefined） */
export function surfaceSlice(source: string, n: SurfaceNode | undefined): string | undefined {
  const start = n?.start;
  const end = n?.end;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  const text = source.slice(start, end).trim();
  return text.length > 0 ? text : undefined;
}

/** 节点上的 TS 类型注解 → 清洗后的类型文本（`: T` 的 T）。 */
export function nodeAnnotationText(
  n: SurfaceNode | undefined,
  source: string | undefined,
): string | undefined {
  if (!source || !n) return undefined;
  // 字段 / 形参注解挂 `typeAnnotation`；方法 / 函数返回注解挂 `returnType`
  // （两者都是 TSTypeAnnotation，真正的类型在 `.typeAnnotation` 上）。
  const ann = (n.typeAnnotation ?? n.returnType) as SurfaceNode | undefined;
  const ta = ann?.typeAnnotation as SurfaceNode | undefined;
  const text = surfaceSlice(source, ta);
  return text ? tsAnnotationTypeText(text) : undefined;
}

/**
 * Bug 44：字段的类型注解只有**引用都在产物里可解析**时才放行。
 * 私有类型名（`Hidden` / 未导入名）落进 .d.ts 会 TS2304 ⇒ 回落 `unknown`
 * （与模块级注解的安全降级同口径）。
 */
export function safeFieldTypeAnnotation(
  text: string | undefined,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
): string | undefined {
  if (!text) return undefined;
  const ok: (n: string, valuePosition?: boolean) => boolean =
    isResolvable ??
    ((n: string) => TS_TYPE_TOKENS.has(n) || isRuntimeGlobalCtorName(n));
  const valueRefs = typeofValueRefs(text);
  return annotationTypeRefs(text).every((n) => ok(n, valueRefs.has(n))) ? text : undefined;
}

/**
 * BUG-130：模块级值声明注解的放行判据（与形参 / 字段同口径）。
 * 引用到产物里不可解析的类型名 ⇒ 不采用（回落观测），并点名首个不可解析名。
 */
export function safeValueAnnotation(
  text: string,
  surface: DtsModuleSurface | undefined,
  refs?: Set<string>,
): { text?: string; unresolved?: string } {
  const valueRefs = typeofValueRefs(text);
  for (const name of annotationTypeRefs(text)) {
    if (!isTypeRefResolvable(name, valueRefs.has(name), surface)) return { unresolved: name };
    if (surface?.classes.has(name) || surface?.imports?.has(name) === true) refs?.add(name);
  }
  return { text };
}
