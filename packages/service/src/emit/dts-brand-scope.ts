/**
 * brand 作用域与裸类名的类型实参占位。
 *
 * 从 dts-generator 抽出：只依赖模块面与注解引用判据，不依赖 Abs 投影上下文。
 */
import type { DtsModuleSurface } from "./dts-ir.ts";
import type { DtsBrandScope } from "./dts-type.ts";
import { annotationTypeRefs, isTypeNameResolvable } from "./dts-annotation-text.ts";
import { splitTopLevel, typeParamNamesInClause } from "./dts-text.ts";

export function brandScopeOf(surface: DtsModuleSurface | undefined): DtsBrandScope {
  const names = new Set<string>();
  const requiredArgFillers = new Map<string, readonly string[]>();
  if (!surface) return { names, requiredArgFillers };
  for (const [name, cls] of surface.classes) {
    names.add(name);
    const fillers = requiredTypeArgFillers(cls.typeParamsText, cls.typeParams, surface);
    if (fillers.length > 0) requiredArgFillers.set(name, fillers);
  }
  // 导入类的形参个数要看被导入模块，模块面拿不到 ⇒ 只能原样（与旧口径一致）。
  for (const name of surface.imports?.keys() ?? []) names.add(name);
  return { names, requiredArgFillers };
}

/** 类型形参子句里的形参名（`<T, U extends X = Y>` ⇒ `["T","U"]`） */


/**
 * BUG-195：源码类型形参子句 + HOF 推导子句 → 一条子句（源码在前，去重）。
 *
 * HOF 分支的自由变元（`B_f`）来自 Abs 域，那里**没有**「源码声明的类型形参」
 * 这个维度 ⇒ 只发 HOF 子句会把 `<U>` 整段抹掉，而形参注解仍原样引用 `U`
 * （TS2304）。两者必须并存（`<U, B_f>`）。
 */

function typeParamHasDefault(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    else if (
      (ch === ">" && text[i - 1] !== "=") ||
      ch === ")" ||
      ch === "]" ||
      ch === "}"
    ) {
      depth--;
    } else if (ch === "=" && depth === 0 && text[i + 1] !== ">") return true;
  }
  return false;
}

/**
 * 裸类名的**必填**类型形参占位实参（BUG-040 + 约束修正）。
 *
 * `class Box<T>` 被投影成裸 `Box` ⇒ TS2314，缺什么补什么；但 `unknown` 会
 * 违反声明里的约束（`class C<T extends string>` ⇒ `C<unknown>` 是 TS2344）：
 * - 无约束 ⇒ `unknown`（无信息，TS 的 top）；
 * - 约束自包含（只引用 TS 内建 / 产物里可解析的名字，且不引用本类自己的
 *   其它形参）⇒ 约束原文（`C<string>`）；
 * - 否则 ⇒ `any`（满足任意约束；比让整份产物编译失败可诊断）。
 */
function requiredTypeArgFillers(
  clause: string | undefined,
  names: readonly string[] | undefined,
  surface: DtsModuleSurface | undefined,
): string[] {
  const fallback = (): string[] => (names ?? []).map(() => "unknown");
  if (!clause) return fallback();
  const trimmed = clause.trim();
  if (!/^</.test(trimmed)) return fallback();
  const lastClose = trimmed.lastIndexOf(">");
  const inner = trimmed.slice(1, lastClose >= 0 ? lastClose : undefined);
  const ownNames = new Set(names ?? typeParamNamesInClause(clause));
  const out: string[] = [];
  for (const part of splitTopLevel(inner, ",")) {
    const text = part.trim();
    if (text === "") continue;
    // 有默认值的形参可省略 ⇒ 不补实参（`class Box<T = string>` 裸名合法）
    if (typeParamHasDefault(text)) continue;
    const m = /^(?:(?:const|in|out)\s+)*[A-Za-z_$][\w$]*\s+extends\s+([\s\S]+)$/.exec(text);
    const constraint = m?.[1]?.trim();
    if (!constraint) {
      out.push("unknown");
      continue;
    }
    // 引用本类其它形参（`U extends T`）在裸名使用点不在作用域里 ⇒ any。
    const selfContained = annotationTypeRefs(constraint).every(
      (n) => !ownNames.has(n) && isTypeNameResolvable(n, surface),
    );
    out.push(selfContained ? constraint : "any");
  }
  return out;
}

