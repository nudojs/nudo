/**
 * 类成员声明面的格式化发射器。
 *
 * 从 `dts-generator.ts` 抽出的纯文本层：修饰符顺序、成员键、方法签名集、
 * 分析面签名行解析。类声明本体（导出形态 / 继承链 / 字段合并）仍由
 * `dts-generator.ts` 的 `dtsClassDeclaration` 组装，避免把上下文渲染回调
 * 一并搬进本模块。
 */
import { WELL_KNOWN_SYMBOLS } from "./dts-type.ts";
import type { DtsClassFieldSurface, DtsClassMethodSurface } from "./dts-ir.ts";
import { formatPropKey, paramDeclOf, splitTopLevel } from "./dts-text.ts";

/**
 * 静态字段修饰符前缀（BUG-041）：`static` 必须排在 `readonly` 之前
 * （TS1029 "'static' modifier must precede 'readonly' modifier"）。旧实现先拼
 * `fieldPrefix`（readonly/accessibility）再拼 `static` ⇒ `readonly static`。
 */
export function staticFieldPrefix(f: DtsClassFieldSurface): string {
  const parts = [
    f.accessibility ?? "",
    "static",
    f.readonly ? "readonly" : "",
    f.isAbstract ? "abstract" : "",
  ].filter(Boolean);
  return `${parts.join(" ")} `;
}

/** 字段修饰符前缀（Bug 77 readonly / Bug 86 accessibility / Bug 42 abstract）。 */
export function fieldPrefix(f: DtsClassFieldSurface): string {
  const parts = [
    f.accessibility ?? "",
    f.isAbstract ? "abstract" : "",
    f.readonly ? "readonly" : "",
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(" ")} ` : "";
}

/**
 * 给分析面方法声明行加访问修饰符（Bug 86）：声明行是 `lines` 的最后一行，
 * JSDoc / 降级台账都在它前面，只给声明行加前缀，注释保持原样。
 */
export function withMethodModifier(lines: string[], prefix: string): string[] {
  if (!prefix || lines.length === 0) return lines;
  const out = [...lines];
  const last = out.length - 1;
  out[last] = `${prefix} ${out[last]}`;
  return out;
}

/** 形参声明 → 基名（`...rest` / `y?` / `y: unknown` ⇒ `rest` / `y` / `y`） */
export function paramBaseName(decl: string): string {
  let t = decl.trim();
  if (t.startsWith("...")) t = t.slice(3);
  const colon = t.indexOf(":");
  if (colon >= 0) t = t.slice(0, colon);
  t = t.trim();
  return t.endsWith("?") ? t.slice(0, -1) : t;
}

/**
 * 分析面签名行 → 形参基名表（`m(x: unknown, y?: T): R;` ⇒ `["x", "y"]`）。
 * 括号按深度配对（形参类型里可能有函数类型）；解析失败 ⇒ undefined。
 */
export function analysisLineParamNames(line: string): string[] | undefined {
  const open = line.indexOf("(");
  if (open < 0) return undefined;
  let depth = 0;
  let close = -1;
  for (let i = open; i < line.length; i++) {
    const ch = line[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return undefined;
  const inner = line.slice(open + 1, close).trim();
  if (inner === "") return [];
  return splitTopLevel(inner, ",").map(paramBaseName);
}

/**
 * 类成员键的声明文本：符号键还原成 `[Symbol.iterator]` 括号形态（BUG-216），
 * 其余与对象键同口径（ident / 数字 / JSON 引号）。
 */
export function memberKeyText(name: string, symbolKey?: boolean): string {
  if (symbolKey === true) {
    const sym = WELL_KNOWN_SYMBOLS.get(name);
    if (sym !== undefined) return `[${sym}]`;
  }
  return formatPropKey(name);
}

/**
 * 类方法声明行（BUG-175 / BUG-215 / BUG-216）：有 `overloads` ⇒ 只发声明集
 * （不发实现），否则发单条签名；`?` / 符号键 / 类型形参子句逐条保留。
 */
export function classMethodDeclLines(
  m: DtsClassMethodSurface,
  opts: { static?: boolean; prefix?: string } = {},
): string[] {
  const st = opts.static === true ? "static " : "";
  const prefix = opts.prefix ?? "";
  const key = `${memberKeyText(m.name, m.symbolKey)}${m.optional ? "?" : ""}`;
  const signatures = m.overloads !== undefined && m.overloads.length > 0 ? m.overloads : [m];
  return signatures.map((sig) => {
    const params = sig.params
      .map((p, i) => paramDeclOf(p, i, sig.paramTypes?.[i]))
      .join(", ");
    return `${prefix}${st}${key}${sig.typeParams ?? ""}(${params}): ${sig.returnType ?? "unknown"};`;
  });
}

/**
 * 观测返回串 → 注解证据收窄（BUG-156）。
 *
 * 只做**收窄**：观测是 `unknown`（求值面没有信息）或是**标量联合**且注解证据
 * 是其中一个成员时采用注解证据。反向（注解证据不在观测串里 / 观测是单类型 /
 * 结构化类型）一律不动——本函数**不放宽**，也不改字面量精度（`2` 保持 `2`）。
 */
export function refineObservedReturn(
  observed: string,
  annotationEvidence?: string,
): string {
  if (annotationEvidence === undefined) return observed;
  if (observed === "unknown") return annotationEvidence;
  const members = observed.split("|").map((s) => s.trim());
  if (members.length < 2) return observed;
  return members.includes(annotationEvidence) ? annotationEvidence : observed;
}
