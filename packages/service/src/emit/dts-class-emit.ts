/**
 * 类成员声明面的格式化发射器。
 *
 * 从 `dts-generator.ts` 抽出的类声明发射器：修饰符顺序、成员键、方法签名集、
 * 分析面签名行解析，以及导出形态 / 构造器 / 字段 / 超类子的组装。继承链证据
 * 由调用方作为参数注入，模块本身不依赖 dts 投影上下文。
 */
import { leqAbs } from "@nudojs/core";
import { absTypeForTsTypeText, sanitizeCommentText } from "@nudojs/core/internal";
import { WELL_KNOWN_SYMBOLS } from "./dts-type.ts";
import type {
  DtsClassFieldSurface,
  DtsClassMethodSurface,
  DtsClassSurface,
} from "./dts-ir.ts";
import { exportNameRepr } from "./export-binding.ts";
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
 * 观测返回串 → **源码注解证据**收窄（BUG-156；无返回注解的实例方法）。
 *
 * 只做**收窄**：观测是 `unknown`（求值面没有信息），或观测与注解证据在 Abs 上
 * 可比（证据 ⊆ 观测域 / 观测 ⊆ 证据域）时采用证据；不可比时回落文本成员
 * 判据（具名类型 Abs 解析不到时）。反向一律不动——不改字面量精度（`2` 保持 `2`）。
 *
 * 只服务**无返回注解**的方法：有注解时返回位由分析面签名单点发布声明
 * （`tsDeclaredReturn`，含不可解析时的 dropped 台账），这里再介入等于绕过
 * 那道可解析门。
 */
export function refineObservedReturn(
  observed: string,
  annotationEvidence?: string,
): string {
  if (annotationEvidence === undefined) return observed;
  if (observed === "unknown") return annotationEvidence;
  const observedAbs = absTypeForTsTypeText(observed);
  const evidenceAbs = absTypeForTsTypeText(annotationEvidence);
  if (observedAbs && evidenceAbs) {
    return leqAbs(observedAbs, evidenceAbs).ok || leqAbs(evidenceAbs, observedAbs).ok
      ? annotationEvidence
      : observed;
  }
  const members = observed.split("|").map((s) => s.trim());
  if (members.length < 2) return observed;
  return members.includes(annotationEvidence) ? annotationEvidence : observed;
}

/** 类声明行（导出形态 + 类型形参 + 超类 + 构造器 + 方法 + 字段 + 修饰符） */
export function dtsClassDeclaration(
  className: string,
  cls: DtsClassSurface | undefined,
  memberList: Array<{ member: string; lines: string[] }>,
  fields: DtsClassFieldSurface[],
  superText = "",
  inheritedStatics: ReadonlySet<string> = new Set(),
  inherited: ReadonlyMap<
    string,
    { lines?: string[]; accessibility?: "private" | "protected" | "public" }
  > = new Map(),
): string[] {
  const body: string[] = [];
  const methodNames = new Set<string>();
  if (cls?.hasPrivateIdentifier) body.push("#private;");
  for (const idx of cls?.indexSignatures ?? []) body.push(idx);
  if (cls?.ctorOverloads !== undefined && cls.ctorOverloads.length > 0) {
    for (const sig of cls.ctorOverloads) {
      const params = sig.params
        .map((p, i) => paramDeclOf(p, i, sig.paramTypes?.[i]))
        .join(", ");
      const ctorAcc = sig.accessibility ?? cls.ctorAccessibility;
      const ctorPrefix = ctorAcc !== undefined ? `${ctorAcc} ` : "";
      body.push(`${ctorPrefix}constructor(${params});`);
    }
  } else if (cls?.ctorParams) {
    const params = cls.ctorParams
      .map((p, i) => paramDeclOf(p, i, cls.ctorParamTypes?.[i]))
      .join(", ");
    const ctorPrefix = cls.ctorAccessibility ? `${cls.ctorAccessibility} ` : "";
    body.push(`${ctorPrefix}constructor(${params});`);
  }
  const instanceSurface = cls?.instanceMethods ?? [];
  const staticSurface = cls?.staticMethods ?? [];
  const staticOnly = new Set(
    [...staticSurface.map((sm) => sm.name), ...inheritedStatics].filter(
      (name) => !instanceSurface.some((im) => im.name === name),
    ),
  );
  const accessibility = new Map<string, string>();
  for (const m of [...instanceSurface, ...staticSurface]) {
    if (m.accessibility) accessibility.set(m.name, m.accessibility);
  }
  // BUG-156：只给**无返回注解**的实例方法补源码注解证据。有注解的方法返回位
  // 已由分析面签名发布声明（`tsDeclaredReturn`：不可解析 ⇒ dropped 台账 +
  // 观测；手写契约返回位优先）——这里再拿证据改写会绕过那道门。
  const refineAnnotationReturn = (member: string, lines: string[]): string[] => {
    const own = instanceSurface.find((x) => x.name === member);
    if (own === undefined || own.returnType !== undefined) return lines;
    const evidence = own.annotationReturnType;
    if (evidence === undefined || lines.length === 0) return lines;
    const last = lines[lines.length - 1]!;
    const sig = /^(.*\)\s*:\s*)(.+?)(;\s*)$/.exec(last);
    if (!sig) return lines;
    const observed = sig[2]!.trim();
    const refined = refineObservedReturn(observed, evidence);
    if (refined === observed) return lines;
    const out = [...lines.slice(0, -1), `${sig[1]}${refined}${sig[3]}`];
    return out.map((l) =>
      l.includes(`@returns ${observed}`)
        ? l.replace(`@returns ${observed}`, `@returns ${refined}`)
        : l,
    );
  };
  for (const m of memberList) {
    if (staticOnly.has(m.member)) continue;
    methodNames.add(m.member);
    const own = instanceSurface.find((x) => x.name === m.member);
    if (own?.overloads !== undefined && own.overloads.length > 0) {
      const prefix = [own.accessibility ?? "", own.isAbstract ? "abstract" : ""]
        .filter(Boolean)
        .join(" ");
      body.push(
        ...classMethodDeclLines(own, { prefix: prefix.length > 0 ? `${prefix} ` : "" }),
      );
      continue;
    }
    const inh = inherited.get(m.member);
    if (inh !== undefined && inh.lines === undefined) continue;
    const lines = inh?.lines ?? refineAnnotationReturn(m.member, m.lines);
    const modifier =
      inh !== undefined ? (inh.accessibility ?? "") : (accessibility.get(m.member) ?? "");
    for (const l of withMethodModifier(lines, modifier)) {
      body.push(...l.split("\n"));
    }
  }
  for (const m of instanceSurface) {
    if (methodNames.has(m.name)) continue;
    methodNames.add(m.name);
    const parts = [m.accessibility ?? "", m.isAbstract ? "abstract" : ""].filter(Boolean);
    const prefix = parts.length > 0 ? `${parts.join(" ")} ` : "";
    body.push(...classMethodDeclLines(m, { prefix }));
  }
  const analysisReturnOf = (name: string, params: readonly string[]): string | undefined => {
    const entry = memberList.find((m) => m.member === name);
    if (!entry) return undefined;
    const last = entry.lines[entry.lines.length - 1];
    if (!last) return undefined;
    const ret = /\)\s*:\s*([^;]+);\s*$/.exec(last);
    if (!ret) return undefined;
    const analysisParams = analysisLineParamNames(last);
    const want = params.map(paramBaseName);
    if (
      !analysisParams ||
      analysisParams.length !== want.length ||
      analysisParams.some((n, i) => n !== want[i])
    ) {
      return undefined;
    }
    return ret[1]?.trim();
  };
  for (const m of staticSurface) {
    const prefix = m.accessibility ? `${m.accessibility} ` : "";
    if (m.overloads !== undefined && m.overloads.length > 0) {
      body.push(...classMethodDeclLines(m, { static: true, prefix }));
      continue;
    }
    const ret =
      m.returnType ??
      analysisReturnOf(m.name, m.params) ??
      m.observedReturnType ??
      "unknown";
    body.push(...classMethodDeclLines({ ...m, returnType: ret }, { static: true, prefix }));
  }
  for (const f of cls?.staticFields ?? []) {
    body.push(
      `${staticFieldPrefix(f)}${memberKeyText(f.name, f.symbolKey)}${f.optional ? "?" : ""}: ${f.type};`,
    );
  }
  for (const a of cls?.accessors ?? []) {
    const acc = a.accessibility ? `${a.accessibility} ` : "";
    const st = a.isStatic ? "static " : "";
    const ab = a.isAbstract ? "abstract " : "";
    const key = memberKeyText(a.name, a.symbolKey);
    body.push(
      a.kind === "get"
        ? `${acc}${st}${ab}get ${key}(): ${a.type};`
        : `${acc}${st}${ab}set ${key}(v: ${a.type});`,
    );
  }
  for (const f of fields) {
    if (methodNames.has(f.name)) continue;
    body.push(
      `${fieldPrefix(f)}${memberKeyText(f.name, f.symbolKey)}${f.optional ? "?" : ""}: ${f.type};`,
    );
  }
  const typeParams = cls?.typeParams ?? [];
  const typeParamsText =
    cls?.typeParamsText ?? (typeParams.length > 0 ? `<${typeParams.join(", ")}>` : "");
  const inner =
    body.length > 0
      ? `\n${body.map((l) => (l.trim() === "" ? l : `  ${l}`)).join("\n")}\n`
      : "";
  const declaredName = className === "default" ? "_default" : className;
  const superExpr = cls?.superExpressionText;
  const baseName = `__nudo_base_${declaredName}`;
  const degradedSuper = superText === "" && superExpr !== undefined;
  const prelude = degradedSuper
    ? [
        `// nudo:unresolved-superclass ${declaredName} — extends ${sanitizeCommentText(superExpr)} (projected as open structural base)`,
        `declare const ${baseName}: { new (): any; [key: string]: any };`,
      ]
    : [];
  const effectiveSuperText = degradedSuper ? ` extends ${baseName}` : superText;
  const implementsText =
    cls?.implements !== undefined && cls.implements.length > 0
      ? ` implements ${cls.implements.join(", ")}`
      : "";
  const header = `${declaredName}${typeParamsText}${effectiveSuperText}${implementsText}`;
  const abs = cls?.isAbstract ? "abstract " : "";
  const exportNames =
    cls?.exportNames ?? (cls?.exportName !== undefined ? [cls.exportName] : []);
  const exportName = exportNames[0];
  const extras = exportNames
    .slice(1)
    .map((n) => `export { ${declaredName} as ${exportNameRepr(n)} };`);
  if (exportName === undefined)
    return [...prelude, `declare ${abs}class ${header} {${inner}}`];
  if (exportName === "default")
    return [...prelude, `export default ${abs}class ${header} {${inner}}`, ...extras];
  if (exportName === className)
    return [...prelude, `export declare ${abs}class ${header} {${inner}}`, ...extras];
  return [
    ...prelude,
    `declare ${abs}class ${header} {${inner}}`,
    `export { ${declaredName} as ${exportNameRepr(exportName)} };`,
    ...extras,
  ];
}
