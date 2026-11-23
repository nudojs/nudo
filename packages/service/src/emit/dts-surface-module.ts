/**
 * namespace 成员的源码面渲染。
 *
 * 从 `dts-generator.ts` 抽出。namespace 成员只需源码 AST + 类扫描结果，
 * 不依赖 Abs 投影上下文；`dtsModuleSurface` 仍负责模块级导出绑定表。
 */
import {
  classMethodDeclLines,
  fieldPrefix,
  memberKeyText,
  staticFieldPrefix,
} from "./dts-class-emit.ts";
import { paramDeclOf } from "./dts-text.ts";
import {
  scanClassSurface,
  superTypeArgsText,
  typeParamClauseText,
} from "./dts-surface-class.ts";
import { valueTypeTextOfInit } from "./dts-surface-value.ts";
import {
  surfaceName,
  surfaceQualifiedName,
  surfaceSlice,
  type SurfaceNode,
} from "./dts-surface-utils.ts";

/** 形参的类型注解文本（`: T`；无注解 ⇒ 空串） */
function surfaceParamType(source: string, n: SurfaceNode | undefined): string {
  const ta = n?.typeAnnotation as SurfaceNode | undefined;
  const t = surfaceSlice(source, ta?.typeAnnotation as SurfaceNode | undefined);
  return t ? `: ${t}` : "";
}

/**
 * namespace 成员形参（ambient 上下文：**默认值非法** ⇒ `a = 1` 降成 `a?: T`）。
 * 解构形参在 ambient 里无法平移到声明位 ⇒ 记 `argN: unknown`（不假造类型）。
 */
function surfaceNamespaceParam(
  p: SurfaceNode | undefined,
  index: number,
  source: string,
): string {
  if (!p) return `arg${index}: unknown`;
  if (p.type === "RestElement") {
    const arg = p.argument as SurfaceNode | undefined;
    return `...${surfaceName(arg) ?? `arg${index}`}${surfaceParamType(source, arg)}`;
  }
  if (p.type === "AssignmentPattern") {
    const left = p.left as SurfaceNode | undefined;
    return `${surfaceName(left) ?? `arg${index}`}?${surfaceParamType(source, left)}`;
  }
  if (p.type === "Identifier") {
    const opt = p.optional === true ? "?" : "";
    return `${surfaceName(p) ?? `arg${index}`}${opt}${surfaceParamType(source, p)}`;
  }
  return `arg${index}: unknown`;
}

/**
 * Bug 76：namespace 内的 `export class` 按 **ambient 声明体**渲染成员。
 *
 * 旧实现无条件发 `export class C {}`（理由：ambient 类体不允许初始化器 /
 * 方法实现）——但声明体（`v: number; m(): number;`）在 ambient 上下文完全
 * 合法，被一并丢掉 ⇒ 消费端 `new NS.C().v` TS2339 而运行时成员都在。
 */
function namespaceClassLines(decl: SurfaceNode, source: string): string[] {
  const name = surfaceName(decl.id as SurfaceNode | undefined);
  if (!name) return [];
  const scanned = scanClassSurface(decl, () => true, source);
  const lines: string[] = [];
  // BUG-031：`export class C extends Base` 的 extends 子句此前整条丢掉 ⇒
  // 消费方拿不到基类成员（TS2339），产物与源码形态不符。类型形参同理。
  const tps = typeParamClauseText(decl.typeParameters as SurfaceNode | undefined, source) ?? "";
  const superName = surfaceQualifiedName(decl.superClass as SurfaceNode | undefined);
  const superArgs = superTypeArgsText(
    decl.superTypeArguments as SurfaceNode | undefined,
    source,
  );
  if (scanned.hasPrivateIdentifier) lines.push("#private;");
  for (const idx of scanned.indexSignatures ?? []) lines.push(idx);
  // BUG-234：重载构造器逐条发射（只发声明集）
  if (scanned.ctorOverloads !== undefined && scanned.ctorOverloads.length > 0) {
    for (const sig of scanned.ctorOverloads) {
      const ctorAcc = sig.accessibility ?? scanned.ctorAccessibility;
      const ctorPrefix = ctorAcc !== undefined ? `${ctorAcc} ` : "";
      lines.push(
        `${ctorPrefix}constructor(${sig.params
          .map((p, i) => paramDeclOf(p, i, sig.paramTypes?.[i]))
          .join(", ")});`,
      );
    }
  } else if (scanned.ctorParams) {
    const ctorPrefix = scanned.ctorAccessibility ? `${scanned.ctorAccessibility} ` : "";
    lines.push(
      `${ctorPrefix}constructor(${scanned.ctorParams
        .map((p, i) => paramDeclOf(p, i, scanned.ctorParamTypes?.[i]))
        .join(", ")});`,
    );
  }
  for (const m of scanned.instanceMethods) {
    const parts = [m.accessibility ?? "", m.isAbstract ? "abstract" : ""].filter(Boolean);
    const prefix = parts.length > 0 ? `${parts.join(" ")} ` : "";
    lines.push(...classMethodDeclLines(m, { prefix }));
  }
  for (const m of scanned.staticMethods) {
    const prefix = m.accessibility ? `${m.accessibility} ` : "";
    lines.push(...classMethodDeclLines(m, { static: true, prefix }));
  }
  for (const f of scanned.staticFields ?? []) {
    lines.push(
      `${staticFieldPrefix(f)}${memberKeyText(f.name, f.symbolKey)}${f.optional ? "?" : ""}: ${f.type};`,
    );
  }
  for (const a of scanned.accessors ?? []) {
    const st = a.isStatic ? "static " : "";
    const key = memberKeyText(a.name, a.symbolKey);
    lines.push(
      a.kind === "get"
        ? `${st}get ${key}(): ${a.type};`
        : `${st}set ${key}(v: ${a.type});`,
    );
  }
  for (const f of scanned.instanceFields ?? []) {
    lines.push(
      `${fieldPrefix(f)}${memberKeyText(f.name, f.symbolKey)}${f.optional ? "?" : ""}: ${f.type};`,
    );
  }
  const header =
    superName !== undefined
      ? `export class ${name}${tps} extends ${superName}${
          superArgs.length > 0 ? `<${superArgs.join(", ")}>` : ""
        }`
      : `export class ${name}${tps}`;
  return lines.length > 0
    ? [`${header} {`, ...lines.map((l) => `  ${l}`), `}`]
    : [`${header} {}`];
}

/**
 * namespace 成员声明行（BUG-191）：让 `.d.ts` 的 `NS` 与源导出面同形。
 *
 * 只渲染**有运行时值**的成员（const/let/var/function/class/enum/嵌套 namespace）
 * 与可镜像的类型成员（interface / type 别名，直接切源码原文——类型是 erasable 的，
 * 原文进 ambient 上下文合法）。class 只发空体：ambient 类体不允许初始化器 /
 * 方法实现，切原文会让整份产物编译不过（TS1039）。
 */
function namespaceMemberLines(
  decl: SurfaceNode | null | undefined,
  source: string,
): string[] {
  if (!decl) return [];
  switch (decl.type) {
    case "VariableDeclaration": {
      const kindRaw = String(decl.kind ?? "let");
      const kind = kindRaw === "const" || kindRaw === "var" ? kindRaw : "let";
      const out: string[] = [];
      for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
        const id = d.id as SurfaceNode | undefined;
        const name = surfaceName(id);
        if (!name) continue;
        // BUG-230：无显式注解时，初始化器形状就是**声明面**的类型证据
        // （`export const inferred = 1` ⇒ `number`，与顶层 `export const` 的
        // widen 口径一致；字面量 widen 到基类型）。旧实现只读源码注解
        // ⇒ 无注解成员一律 `unknown`（消费方 `const n: number = N.inferred`
        // 报 TS2322）。表达式 / 标识符不猜（`valueTypeTextOfInit` 给 unknown）。
        const annotation = surfaceParamType(source, id).slice(2);
        const t =
          annotation ||
          (id?.type === "Identifier"
            ? valueTypeTextOfInit(d.init as SurfaceNode | undefined, source)
            : "unknown");
        out.push(`export ${kind} ${name}: ${t};`);
      }
      return out;
    }
    case "FunctionDeclaration": {
      const name = surfaceName(decl.id as SurfaceNode | undefined);
      if (!name) return [];
      const params = ((decl.params as SurfaceNode[] | undefined) ?? []).map((p, i) =>
        surfaceNamespaceParam(p, i, source),
      );
      const rt = decl.returnType as SurfaceNode | undefined;
      const ret = surfaceSlice(source, rt?.typeAnnotation as SurfaceNode | undefined) ?? "unknown";
      // BUG-027：类型形参子句必须跟着走，否则 `id<T>(v: T): T` 落成
      // `id(v: T): T` —— `T` 在产物里无处声明，`tsc --strict` 直接 TS2304，
      // 而 `nudo export` / `nudo check` 双绿。
      const tps = typeParamClauseText(
        decl.typeParameters as SurfaceNode | undefined,
        source,
      ) ?? "";
      const paramsText = params.join(", ");
      return [`export function ${name}${tps}(${paramsText}): ${ret};`];
    }
    case "ClassDeclaration": {
      // Bug 76：ambient 声明体合法 ⇒ 发射成员，不再无条件空类体。
      return namespaceClassLines(decl, source);
    }
    case "TSEnumDeclaration":
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration": {
      // 枚举成员初始化器在 ambient 上下文合法；interface / type 别名本就是
      // 纯类型 ⇒ 三者都可以直接镜像源码原文。
      const text = surfaceSlice(source, decl);
      if (!text) return [];
      const lines = text.split("\n");
      return [`export ${lines[0]!.trim()}`, ...lines.slice(1)];
    }
    case "TSModuleDeclaration": {
      const name = surfaceName(decl.id as SurfaceNode | undefined);
      if (!name) return [];
      return [
        `export namespace ${name} {`,
        ...namespaceMembersOf(decl, source).map((l) => `  ${l}`),
        `}`,
      ];
    }
    default:
      return [];
  }
}

/** namespace 体 → 成员行（`namespace A.B` 的尾段挂在嵌套 TSModuleDeclaration 上） */
export function namespaceMembersOf(decl: SurfaceNode, source: string): string[] {
  const body = decl.body as SurfaceNode | undefined;
  if (body && body.type === "TSModuleDeclaration") {
    const name = surfaceName(body.id as SurfaceNode | undefined);
    if (!name) return [];
    return [
      `export namespace ${name} {`,
      ...namespaceMembersOf(body, source).map((l) => `  ${l}`),
      `}`,
    ];
  }
  const out: string[] = [];
  for (const stmt of (body?.body as SurfaceNode[] | undefined) ?? []) {
    // 只有 `export` 的成员对外可见（未导出成员是 namespace 内部绑定）
    if (stmt.type !== "ExportNamedDeclaration") continue;
    out.push(...namespaceMemberLines(stmt.declaration as SurfaceNode | null | undefined, source));
  }
  return out;
}
