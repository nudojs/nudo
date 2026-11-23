/**
 * namespace 成员的源码面渲染。
 *
 * 从 `dts-generator.ts` 抽出。namespace 成员只需源码 AST + 类扫描结果，
 * 不依赖 Abs 投影上下文；`dtsModuleSurface` 仍负责模块级导出绑定表。
 */
import { parseSource } from "@nudojs/core";
import { isJsBindingIdent } from "@nudojs/core/internal";
import { isRuntimeGlobalCtorName } from "./schema-generator.ts";
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
import { enumConstValue, enumInitTextOfValue } from "./dts-surface-enum.ts";
import {
  constAwareValueType,
  containsConstAssertion,
  defaultParamTypeTexts,
  isConstAssertionNode,
  objectFnMemberAnnotations,
  surfaceMemberFn,
  surfaceParamNames,
  userSymbolMemberKeys,
  valueTypeTextOfInit,
} from "./dts-surface-value.ts";
import {
  cjsPropName,
  isExportsTarget,
  isFnOrClassInit,
  nodeAnnotationText,
  patternBindingNames,
  safeFieldTypeAnnotation,
  surfaceName,
  surfaceQualifiedName,
  surfaceSlice,
  type SurfaceNode,
} from "./dts-surface-utils.ts";
import { TS_TYPE_TOKENS } from "./dts-annotation-text.ts";
import {
  ambientFunctionDeclarationText,
  dtsExportNamesOf,
} from "./dts-module-emit.ts";
import { exportNameRepr } from "./export-binding.ts";
import type { DtsImportSurface, DtsModuleSurface } from "./dts-ir.ts";

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

/**
 * 模块导出面扫描（源文件 → 导出名表 + 类面 + 再导出语句）。
 *
 * 与 core 侧车的 `localNamedExports` 同源同口径（同一 AST 扫描），但**多**给
 * 两样东西：导出名 → 本地绑定的**映射**（别名导出要按导出名声明）与再导出
 * 语句（dts 要复现再导出面）。
 */
export function dtsModuleSurface(source: string): DtsModuleSurface {
  const surface: DtsModuleSurface = {
    exportBindings: new Map(),
    reexports: [],
    classes: new Map(),
    imports: new Map(),
    values: new Map(),
    namespaces: new Map(),
    typeDeclarations: [],
    typeNames: new Set(),
    valueNames: new Set(),
    typeOnlyExportBindings: new Map(),
    typeParamClauses: new Map(),
    paramDefaults: new Map(),
    namespaceImports: new Map(),
    functionOverloads: new Map(),
  };
  /** BUG-008：`module.exports = <单值>` 的目标（`""` = 匿名右值）；见 surface.exportEquals */
  let exportEqualsCandidate: string | undefined;
  let ast: { program: { body: SurfaceNode[] } };
  try {
    // `keepTs`：导出面扫描要看到 **TS 语法本身** —— `import type`（BUG-168：
    // 注解原文引用的类型名要能补 `import type`）、`export type`、类类型形参
    // （`class Box<T>`）、TS `enum`（BUG-190）在剥除后的 AST 上**都已消失**。
    ast = parseSource(source, { errorRecovery: true, keepTs: true }) as unknown as {
      program: { body: SurfaceNode[] };
    };
  } catch {
    return surface; // 解析失败：无导出面信息，不阻断（与 core 侧车同口径）
  }
  const body = ast.program.body;
  const bind = (exportName: string, local: string): void => {
    if (!exportName) return;
    if (!surface.exportBindings.has(exportName)) surface.exportBindings.set(exportName, local);
  };

  /**
   * Bug 62：CJS 值导出登记 `surface.values`（此前只 `bind` ⇒ 导出名表有、
   * 值声明表没有 ⇒ dts 面整体缺席；值-only 模块还触发 export 命令空产物早退）。
   * 类型取初始化器形状（分析面对 CJS 赋值没有绑定 Abs 可用）。
   */
  const noteCjsValue = (name: string, init: SurfaceNode | undefined): void => {
    if (!name || surface.values.has(name)) return;
    surface.values.set(name, { kind: "const", typeText: valueTypeTextOfInit(init, source) });
  };


  // ── 类声明（本地名 → AST 节点） ──
  const classDecls = new Map<string, SurfaceNode>();
  /** BUG-360：类表达式绑定（值是构造器，不是类型名）。 */
  const classExpressions = new Set<string>();
  const addClass = (decl: SurfaceNode | null | undefined, preferName?: string): void => {
    // Bug 61：`export const C = class { … }` 的 ClassExpression 也是完整类值，
    // 只认 ClassDeclaration ⇒ dts 落成 `const C: unknown`（消费端 TS18046）。
    if (decl?.type !== "ClassDeclaration" && decl?.type !== "ClassExpression") return;
    // 类表达式自身的 id 是内部名（`class D {}`）⇒ 导出身份是变量名（preferName）。
    const id = preferName ?? surfaceName(decl.id as SurfaceNode | undefined);
    if (id && !classDecls.has(id)) {
      classDecls.set(id, decl);
      if (decl.type === "ClassExpression") classExpressions.add(id);
    }
  };
  /** `export const C = class {}` / `const C = class {}` 的类表达式注册 */
  const scanVarDeclsForClassExpr = (vd: SurfaceNode | null | undefined): void => {
    if (vd?.type !== "VariableDeclaration") return;
    for (const d of (vd.declarations as SurfaceNode[] | undefined) ?? []) {
      const id = surfaceName(d.id as SurfaceNode | undefined);
      const init = d.init as SurfaceNode | undefined;
      if (id && (init?.type === "ClassExpression" || init?.type === "ClassDeclaration")) {
        addClass(init, id);
      }
    }
  };
  for (const stmt of body) {
    if (stmt.type === "ClassDeclaration") {
      addClass(stmt);
      continue;
    }
    if (stmt.type === "VariableDeclaration") {
      scanVarDeclsForClassExpr(stmt);
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const d = stmt.declaration as SurfaceNode | null | undefined;
      if (d?.type === "VariableDeclaration") scanVarDeclsForClassExpr(d);
      else addClass(d);
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration as SurfaceNode | null | undefined;
      // Bug 12：匿名 `export default class { … }` 没有 id ⇒ 注册到普查名
      // "default" 上（类方法普查名是 `default.m`），让类声明面能合成它。
      if (d?.type === "ClassDeclaration" && !surfaceName(d.id as SurfaceNode | undefined)) {
        if (!classDecls.has("default")) classDecls.set("default", d);
      } else {
        addClass(d);
      }
    }
  }

  // ── 导入面（Bug 233：brand 类名来自别的模块 ⇒ 产物里要能解析那个名字）──
  // 具名导入按**导出名**记（`import { X as Y }` ⇒ 键 "X"——补 import 用导出名）；
  // 默认导入按**本地名**记；命名空间导入不能当类型名 ⇒ 不收。
  const imports = surface.imports ?? new Map<string, DtsImportSurface>();
  for (const stmt of body) {
    // BUG-387：`import src = require("./types")` 的导入面。
    if (stmt.type === "TSImportEqualsDeclaration") {
      const local = surfaceName(stmt.id as SurfaceNode | undefined);
      const ref = stmt.moduleReference as SurfaceNode | undefined;
      const specifier =
        ref?.type === "TSExternalModuleReference"
          ? String((ref.expression as SurfaceNode | undefined)?.value ?? "")
          : "";
      if (local && specifier && !imports.has(local)) {
        imports.set(local, { specifier, kind: "equals" });
      }
      continue;
    }
    if (stmt.type !== "ImportDeclaration") continue;
    const from = stmt.source as SurfaceNode | undefined;
    const specifier = String(from?.value ?? "");
    if (!specifier) continue;
    for (const spec of (stmt.specifiers as SurfaceNode[] | undefined) ?? []) {
      if (spec.type === "ImportDefaultSpecifier") {
        const local = surfaceName(spec.local as SurfaceNode | undefined);
        if (local && !imports.has(local)) {
          imports.set(local, { specifier, kind: "default" });
        }
        continue;
      }
      if (spec.type === "ImportNamespaceSpecifier") {
        // Bug 49：命名空间导入自己不能当类型名用，但 `extends NS.Base` 需要
        // 补 `import * as NS from "…"` 才可解析 ⇒ 单独登记。
        const local = surfaceName(spec.local as SurfaceNode | undefined);
        if (local) surface.namespaceImports!.set(local, specifier);
        continue;
      }
      if (spec.type !== "ImportSpecifier") continue;
      const exported = surfaceName(spec.imported as SurfaceNode | undefined);
      if (!exported) continue;
      if (!imports.has(exported)) {
        imports.set(exported, { specifier, kind: "named" });
      }
      // BUG-012：`import { X as Y }` —— 本地名 Y 也要能查到来源（再导出用）。
      const local = surfaceName(spec.local as SurfaceNode | undefined);
      if (local && local !== exported && !imports.has(local)) {
        imports.set(local, { specifier, kind: "named", importedName: exported });
      }
    }
  }

  // ── 导出名表 + 再导出语句 ──
  /**
   * BUG-217：`export { I as IA }` 里**被导出的是类型声明**的组（按源语句分组，
   * 与 tsc 同形）。判定推迟到类型声明扫描之后（`typeNames` 才齐）。
   */
  const pendingTypeAliasExports: Array<{
    typeOnly: boolean;
    aliases: Array<{ local: string; exported: string }>;
  }> = [];
  for (const stmt of body) {
    if (stmt.type === "ExportAllDeclaration") {
      // `export * from "x"` / `export * as ns from "x"`（Babel：独立节点）
      const from = stmt.source as SurfaceNode | undefined;
      const src = JSON.stringify(String(from?.value ?? ""));
      const ns = surfaceName(stmt.exported as SurfaceNode | undefined);
      // BUG-309：`export type * from` / `export type * as ns from` 的 `type`
      // 必须保留——否则仅类型导出被发布成值导出。
      const typeKw = stmt.exportKind === "type" ? "type " : "";
      if (ns) {
        surface.reexports.push(`export ${typeKw}* as ${exportNameRepr(ns)} from ${src};`);
        bind(ns, "");
      } else {
        surface.reexports.push(`export ${typeKw}* from ${src};`);
      }
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const from = stmt.source as SurfaceNode | undefined;
      const specs = (stmt.specifiers as SurfaceNode[] | undefined) ?? [];
      if (from) {
        // 再导出：`export * from` / `export { a as b } from` / `export * as ns from`
        const src = JSON.stringify(String(from.value ?? ""));
        // BUG-309：语句级 `export type { … } from`。
        const stmtTypeOnly = stmt.exportKind === "type";
        if (specs.length === 0) {
          surface.reexports.push(`export ${stmtTypeOnly ? "type " : ""}* from ${src};`);
          continue;
        }
        const parts: string[] = [];
        for (const spec of specs) {
          // BUG-309：specifier 级 `export { type x as y } from`。
          const specTypeKw = spec.exportKind === "type" && !stmtTypeOnly ? "type " : "";
          if (spec.type === "ExportNamespaceSpecifier") {
            const ns = surfaceName(spec.exported as SurfaceNode | undefined);
            if (!ns) continue;
            // Bug 19：`export * as ns from` 只能写成独立语句，
            // `export { * as ns } from` 是非法 TS（TS1003/1005/1128/1434）。
            // Babel 8 把 `export * as ns from` 解析成 ExportNamedDeclaration +
            // ExportNamespaceSpecifier ⇒ 这条分支才是它真正走到的地方。
            surface.reexports.push(
              `export ${stmtTypeOnly ? "type " : ""}* as ${exportNameRepr(ns)} from ${src};`,
            );
            bind(ns, "");
            continue;
          }
          if (spec.type !== "ExportSpecifier") continue;
          const local = surfaceName(spec.local as SurfaceNode | undefined);
          const exported = surfaceName(spec.exported as SurfaceNode | undefined);
          if (!exported) continue;
          bind(exported, "");
          // Bug 30：导出名 / 本地名都走 exportNameRepr（字符串名 `a-b` ⇒ `"a-b"`）。
          const localRepr = exportNameRepr(local ?? exported);
          const exportedRepr = exportNameRepr(exported);
          parts.push(
            `${specTypeKw}${
              local && local !== exported
                ? `${localRepr} as ${exportedRepr}`
                : exportedRepr
            }`,
          );
        }
        if (parts.length > 0) {
          surface.reexports.push(
            `export ${stmtTypeOnly ? "type " : ""}{ ${parts.join(", ")} } from ${src};`,
          );
        }
        continue;
      }
      const decl = stmt.declaration as SurfaceNode | null | undefined;
      if (decl) {
        if (
          decl.type === "FunctionDeclaration" ||
          decl.type === "ClassDeclaration" ||
          // BUG-190：`export enum Mode` 也是一条导出声明（旧实现漏登记 ⇒
          // 值声明永远不落地；`keepTs` 下 enum 不再是 VariableDeclaration）。
          decl.type === "TSEnumDeclaration"
        ) {
          const id = surfaceName(decl.id as SurfaceNode | undefined);
          if (id) bind(id, id);
        } else if (decl.type === "TSDeclareFunction") {
          // BUG-131：ambient `export declare function f(): T;` 没有函数体、
          // 不进分析面 ⇒ 旧实现既不登记也不发射，整条从产物消失（消费方
          // TS2305）。声明面即事实：原文镜像进产物（与 interface/type 同口径）。
          const id = surfaceName(decl.id as SurfaceNode | undefined);
          if (id) {
            bind(id, id);
            const text = surfaceSlice(source, stmt);
            if (text) {
              surface.typeDeclarations!.push(ambientFunctionDeclarationText(text));
              surface.functionOverloads!.set(id, { exported: true });
            }
          }
        } else if (decl.type === "VariableDeclaration") {
          for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
            // Bug 63：解构导出绑定（ObjectPattern / ArrayPattern / RestElement）
            // 的导出名此前恒为 undefined ⇒ bind 从未发生 ⇒ dts 面整体缺席。
            for (const id of patternBindingNames(d.id as SurfaceNode | undefined)) {
              bind(id, id);
            }
          }
        } else if (decl.type === "TSModuleDeclaration") {
          // BUG-191：`export namespace NS { … }` 的 dts 模块面——旧实现只认
          // 函数/类/枚举/变量 ⇒ namespace 不登记、不发射 ⇒ 产物里没有 NS
          // （消费端 TS2305）。成员按源码形态镜像（见 namespaceMembersOf）。
          const id = surfaceName(decl.id as SurfaceNode | undefined);
          if (id) {
            bind(id, id);
            surface.namespaces!.set(id, {
              members: namespaceMembersOf(decl, source),
            });
          }
        }
        continue;
      }
      // BUG-217：类型声明的导出别名要单独记（见 pendingTypeAliasExports）——
      // 类型名的可判定性（typeNames）要等下面的原文镜像扫描结束。
      const stmtTypeOnly = stmt.exportKind === "type";
      const aliasSpecs = specs
        .filter((spec): spec is SurfaceNode => spec.type === "ExportSpecifier");
      // BUG-309：`export { type innerFn as localFn };`（无 source）的 specifier
      // 级 `type` 与语句级同义——两者都要落到仅类型别名表。
      pendingTypeAliasExports.push({
        typeOnly:
          stmtTypeOnly ||
          (aliasSpecs.length > 0 && aliasSpecs.every((spec) => spec.exportKind === "type")),
        aliases: aliasSpecs
          .map((spec) => ({
            local: surfaceName(spec.local as SurfaceNode | undefined),
            exported: surfaceName(spec.exported as SurfaceNode | undefined),
          }))
          .filter(
            (a): a is { local: string; exported: string } =>
              a.local !== undefined && a.exported !== undefined,
          ),
      });
      for (const spec of aliasSpecs) {
        if (!stmtTypeOnly && spec.exportKind !== "type") continue;
        // 记录「这个 export 名是仅类型」——发射通道（值 / 类 / 导入绑定）据此
        // 保留 `type` 修饰符，而不是把它发布成值导出。
        const exportedName = surfaceName(spec.exported as SurfaceNode | undefined);
        const localName = surfaceName(spec.local as SurfaceNode | undefined);
        if (exportedName !== undefined && localName !== undefined) {
          surface.typeOnlyExportBindings!.set(exportedName, localName);
        }
      }
      for (const spec of specs) {
        if (spec.type === "ExportNamespaceSpecifier") {
          const ns = surfaceName(spec.exported as SurfaceNode | undefined);
          if (ns) bind(ns, "");
          continue;
        }
        if (spec.type !== "ExportSpecifier") continue;
        const local = surfaceName(spec.local as SurfaceNode | undefined);
        const exported = surfaceName(spec.exported as SurfaceNode | undefined);
        if (!exported || !local) continue;
        bind(exported, local);
        // BUG-390：本地再导出命名空间导入 —— 产物补
        // `import * as ns …; export { ns };`（不得静默空产物）。
        if (surface.namespaceImports?.has(local)) {
          surface.reexports.push(
            `export { ${exportNameRepr(local)} as ${exportNameRepr(exported)} };`,
          );
        }
      }
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration as SurfaceNode | null | undefined;
      if (!decl) {
        bind("default", "");
        continue;
      }
      if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
        // 匿名默认类 / 函数没有本地绑定名。匿名默认**类**的类声明面由
        // `classDecls` 里按普查名 "default" 的注册承载（Bug 12A），与这里的
        // 导出绑定表无关（dtsExportNamesOf 对 "default" 有专用分支）。
        bind("default", surfaceName(decl.id as SurfaceNode | undefined) ?? "");
        continue;
      }
      if (decl.type === "ArrowFunctionExpression" || decl.type === "FunctionExpression") {
        // 匿名默认函数由普查面函数声明发射（Bug 12B 给名字），不另发值声明
        // （否则与 `export default function …` 撞成两个 default 导出）。
        bind("default", "");
        continue;
      }
      if (decl.type === "Identifier") {
        bind("default", surfaceName(decl) ?? "");
        continue;
      }
      // BUG-272：`export default interface D { … }` / `export default type T = …`
      // 是**类型声明**，不是值表达式——旧实现落到下面的 `_default: unknown`
      // 值通道，接口声明与 typeNames 登记双双丢失（消费方 `import D` 当类型
      // 用 TS2749）。原文镜像进 typeDeclarations（切片本身带 `export default`）。
      if (decl.type === "TSInterfaceDeclaration" || decl.type === "TSTypeAliasDeclaration") {
        const name = surfaceName(decl.id as SurfaceNode | undefined);
        const text = surfaceSlice(source, stmt);
        if (text) surface.typeDeclarations!.push(text);
        if (name) surface.typeNames!.add(name);
        continue;
      }
      // Bug 20：非函数 / 非标识符的 `export default <表达式>`（42 / "x" /
      // {…} / fac()）从 dts 模块面整体消失 ⇒ 登记一条合成值绑定 `_default`。
      //
      // BUG-009：类型必须走 `valueTypeTextOfInit`（对象逐成员 / 数组按元素
      // join）——`classFieldTypeOfInit` 只给宽类型 `object` / `unknown[]`，
      // 消费方 `cfg.a` 直接 TS2339。与 CJS `module.exports = {…}` 同口径。
      if (!surface.values.has("_default")) {
        surface.values.set("_default", {
          kind: "const",
          typeText: valueTypeTextOfInit(decl, source),
        });
      }
      bind("default", "_default");
      continue;
    }
    if (stmt.type === "ExpressionStatement") {
      const expr = stmt.expression as SurfaceNode | undefined;
      if (expr?.type !== "AssignmentExpression" || expr.operator !== "=") continue;
      const left = expr.left as SurfaceNode | undefined;
      const right = expr.right as SurfaceNode | undefined;
      if (!left || !right) continue;
      const prop = cjsPropName(left);
      if (prop && prop !== "default") {
        bind(prop, prop);
        // Bug 62：`exports.num = 1` 等值导出登记值声明（函数 / 类右值走函数面）
        if (!isFnOrClassInit(right)) noteCjsValue(prop, right);
        continue;
      }
      if (!isExportsTarget(left)) continue;
      if (right.type === "ObjectExpression") {
        for (const p of (right.properties as SurfaceNode[] | undefined) ?? []) {
          const key = surfaceName(p.key as SurfaceNode | undefined);
          if (!key || key === "default") continue;
          bind(key, key);
          // 只有值成员登记值声明（方法 / 函数值属性走函数声明面）
          const v = (p.value ?? undefined) as SurfaceNode | undefined;
          if (p.type !== "ObjectMethod" && p.type !== "ClassMethod" && !isFnOrClassInit(v)) {
            noteCjsValue(key, v);
          }
        }
        continue;
      }
      if (right.type === "Identifier") {
        const n = surfaceName(right);
        if (n) {
          bind(n, n);
          // BUG-008：`module.exports = real` —— 模块形态是 `export =`。
          exportEqualsCandidate = n;
        }
        continue;
      }
      bind("default", "");
      // BUG-008：`module.exports = function () {}`（匿名右值）同样是 `export =`
      exportEqualsCandidate = "";
    }
  }

  // BUG-175：**未带 export** 的顶层重载声明（`function over(a: s): s;` +
  // `export { over as over2 }`）——导出别名由 `dtsExtraExportLines` 补，声明
  // 本身按 ambient 形态镜像（`.d.ts` 与 stdout 平铺面都可编译）。
  for (const stmt of body) {
    if (stmt.type !== "TSDeclareFunction") continue;
    const id = surfaceName(stmt.id as SurfaceNode | undefined);
    if (id === undefined) continue;
    const text = surfaceSlice(source, stmt);
    if (text === undefined) continue;
    surface.typeDeclarations!.push(ambientFunctionDeclarationText(text));
    surface.functionOverloads!.set(id, { exported: false });
  }

  // BUG-008：`export =` 的形态判定放在**镜像类型声明扫描之后**（见下）——
  // `export interface` / `export type` 同样是「其它导出」（TS2309）。

  // ── 模块级值声明（BUG-190）──
  // `export const/let/var` 与 TS `enum` 在导出名表里已登记，但旧实现只发射
  // 函数与类 ⇒ 这些绑定**被登记但从不落地** ⇒ 发布的 `.d.ts` 里没有它们
  // ⇒ 消费端 `import { VERSION }` 报 TS2305，而运行时确实有该导出。
  // 这里只采集**声明形态**（种类 + enum 成员名）；值的类型来自分析面绑定
  // （`projectModuleDts` 的 `values` 实参）。
  /** Bug 77：`{…} as const` / `<const>{…}` ⇒ 对象槽按只读投影。 */
  const isAsConst = (init: SurfaceNode | undefined): boolean => isConstAssertionNode(init);
  // BUG-258：顶层值名（`typeof target` 只对真正存在的绑定成立）——在值声明
  // 扫描之前一次性收集，避免把局部 / 未声明名字写成 TS2304。
  const knownTopLevelValues = new Set<string>();
  for (const stmt of body) {
    const decl =
      stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
        ? ((stmt.declaration as SurfaceNode | null | undefined) ?? stmt)
        : stmt;
    if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
      const id = surfaceName(decl.id as SurfaceNode | undefined);
      if (id) knownTopLevelValues.add(id);
    } else if (decl.type === "VariableDeclaration") {
      for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
        for (const id of patternBindingNames(d.id as SurfaceNode | undefined)) {
          knownTopLevelValues.add(id);
        }
      }
    } else if (decl.type === "ImportDeclaration") {
      for (const spec of (decl.specifiers as SurfaceNode[] | undefined) ?? []) {
        const local = surfaceName(spec.local as SurfaceNode | undefined);
        if (local) knownTopLevelValues.add(local);
      }
    }
  }
  /** BUG-264：`const s = Symbol("…")` ⇒ `unique symbol`（`Symbol.for` 除外）。 */
  const isUniqueSymbolInit = (init: SurfaceNode | undefined): boolean =>
    init?.type === "CallExpression" &&
    surfaceName(init.callee as SurfaceNode | undefined) === "Symbol" &&
    (init.callee as SurfaceNode | undefined)?.type === "Identifier";
  const noteValueDecl = (decl: SurfaceNode | null | undefined): void => {
    if (!decl) return;
    if (decl.type === "VariableDeclaration") {
      const raw = String(decl.kind ?? "");
      const kind = raw === "const" || raw === "var" ? raw : "let";
      for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
        const init = d.init as SurfaceNode | undefined;
        const idNode = d.id as SurfaceNode | undefined;
        // BUG-130：声明器的类型注解（`export const c1: number[] = []`）。只对
        // 单标识符绑定采集——解构模式上的注解描述的是**整个模式**，不能当成
        // 每个绑定各自的类型。
        const annotation =
          idNode?.type === "Identifier" ? nodeAnnotationText(idNode, source) : undefined;
        // BUG-140：绑定本身不是 `as const`、但初始化器内部有断言
        // （`{ x: [1, 2] as const }`）⇒ 按源码逐层冻结语义投影，别走可变容器
        // 拓宽（那会把内层元组的字面量与只读一起拓掉）。
        //
        // 回归修正：与 `annotation` 同一条守卫——只对**单标识符**绑定挂这个
        // 类型。解构模式（`const { x, y } = { … }`）的初始化器类型描述的是
        // **整个右值**，挂到每个绑定上会让 `x`/`y` 都声明成整个对象
        // （消费端 TS2339）；模式绑定回落到分析面的观测类型。
        const nestedConstType =
          idNode?.type === "Identifier" && !isAsConst(init) && containsConstAssertion(init)
            ? constAwareValueType(init, source)
            : undefined;
        // BUG-157：对象字面量成员函数的源码注解（求值面只有形参名）。只对
        // 单标识符绑定采集——解构模式上的初始化器类型描述的是整个右值。
        const fnMemberAnnotations =
          idNode?.type === "Identifier" ? objectFnMemberAnnotations(init, source) : [];
        // BUG-258 / BUG-254：源码初始化器里 Abs 表达不了的声明事实（`typeof X`
        // 引用 / 显式泛型实参）。只对单标识符绑定采集。
        const initTypeText =
          idNode?.type === "Identifier"
            ? valueTypeTextOfInit(init, source, (n) => knownTopLevelValues.has(n))
            : undefined;
        // BUG-263：用户符号成员键（`{ [tag]: 1 }`）的源码名。
        const userSymbolKeys =
          idNode?.type === "Identifier" ? userSymbolMemberKeys(init) : [];
        // BUG-264：`const s = Symbol("s")`（无显式 `: symbol` 注解）⇒ unique symbol。
        const uniqueSymbol =
          kind === "const" &&
          idNode?.type === "Identifier" &&
          annotation === undefined &&
          isUniqueSymbolInit(init);
        // BUG-260：只有 `const <ident> = <primitive literal>` 保留字面量；
        // 解构 / 复合初始化器仍走拓宽（与 tsc 的 const 推断一致）。
        const literalConst =
          kind === "const" &&
          idNode?.type === "Identifier" &&
          annotation === undefined &&
          (init?.type === "StringLiteral" ||
            init?.type === "NumericLiteral" ||
            init?.type === "BooleanLiteral" ||
            init?.type === "BigIntLiteral");
        // BUG-358：该绑定是值（不是函数 / 类值）——同名 phantom 函数入口不得
        // 抢占它的导出声明。
        const nonFunctionValue =
          init == null ||
          (init.type !== "ArrowFunctionExpression" &&
            init.type !== "FunctionExpression" &&
            init.type !== "ClassExpression" &&
            init.type !== "FunctionDeclaration" &&
            init.type !== "ClassDeclaration");
        // Bug 63：解构声明模式展开**全部绑定名**（`{ a, b }` / `[c, ...rest]`）
        // ⇒ 每个绑定都进 surface.values（dtsValueDeclarations 逐条读它）。
        for (const id of patternBindingNames(idNode)) {
          if (surface.values.has(id)) continue;
          surface.values.set(id, {
            kind,
            ...(isAsConst(init) ? { asConst: true } : {}),
            ...(annotation !== undefined ? { annotation } : {}),
            ...(nestedConstType !== undefined ? { nestedConstType } : {}),
            ...(fnMemberAnnotations.length > 0 ? { fnMemberAnnotations } : {}),
            ...(initTypeText !== undefined ? { initTypeText } : {}),
            ...(literalConst ? { literalConst: true } : {}),
            ...(uniqueSymbol ? { uniqueSymbol: true } : {}),
            ...(userSymbolKeys.length > 0 ? { userSymbolKeys } : {}),
            ...(nonFunctionValue ? { nonFunctionValue: true } : {}),
          });
        }
      }
      return;
    }
    if (decl.type === "TSEnumDeclaration") {
      const id = surfaceName(decl.id as SurfaceNode | undefined);
      if (!id) return;
      // Babel 的 enum 成员数组有两种形态：旧版直接挂 `members`，新版包在
      // `TSEnumBody` 里（`body.members`）——都读。
      const enumBody = decl.body as SurfaceNode | undefined;
      const members = Array.isArray(decl.members)
        ? (decl.members as SurfaceNode[])
        : Array.isArray(enumBody)
          ? (enumBody as SurfaceNode[])
          : Array.isArray(enumBody?.members)
            ? (enumBody!.members as SurfaceNode[])
            : [];
      const enumMembers: { name: string; init?: string }[] = [];
      // BUG-139：数值 enum 的隐式自增必须算出字面量（tsc 产物同口径）——
      // 否则消费端 `const y: 2 = E.B` 因成员类型退成 `E.B` 而 TS2322。
      //
      // 回归修正：**只有**「源码没写初始化器」(`initNode === undefined`) 才能
      // 自增。写了但不可折的初始化器（`B = val()` / `A = other.length`）既
      // 不能凭空 +1（`enum E { A = 1, B = val() }` 的 B 不是 2），也不能猜值 ⇒
      // 只发射成员名并断开数值链（tsc `--declaration` 同形：`B`）。
      let prevNumeric: number | undefined = -1; // 首个无初始化器成员 ⇒ 0（tsc 同口径）
      const constValues = new Map<string, number | string>();
      for (const m of members) {
        const name =
          surfaceName(m.id as SurfaceNode | undefined) ??
          surfaceName(m.key as SurfaceNode | undefined);
        if (!name) continue;
        const initNode = m.initializer as SurfaceNode | undefined;
        if (initNode === undefined) {
          if (prevNumeric !== undefined) {
            prevNumeric += 1;
            constValues.set(name, prevNumeric);
            enumMembers.push({ name, init: String(prevNumeric) });
          } else {
            enumMembers.push({ name });
          }
          continue;
        }
        const value = enumConstValue(initNode, constValues);
        if (value === undefined) {
          prevNumeric = undefined;
          enumMembers.push({ name });
          continue;
        }
        constValues.set(name, value);
        // 字符串成员不参与后续自增（`enum { A = "a", B }` 本身是 TS1061）。
        prevNumeric = typeof value === "number" ? value : undefined;
        enumMembers.push({ name, init: enumInitTextOfValue(value) });
      }
      // Bug 25：`export const enum` 的 `const` 限定必须保留（否则消费端 tsc
      // 通过、运行时 import 报「does not provide an export named …」）。
      surface.values.set(id, {
        kind: "enum",
        enumMembers,
        ...(decl.const === true ? { constEnum: true } : {}),
      });
    }
  };
  for (const stmt of body) {
    if (stmt.type === "VariableDeclaration" || stmt.type === "TSEnumDeclaration") {
      noteValueDecl(stmt);
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      noteValueDecl(stmt.declaration as SurfaceNode | null | undefined);
    }
  }
  // BUG-262：值命名空间的名字面（`typeof X` 的 X 是**值**，不是类型）。
  for (const local of surface.values.keys()) surface.valueNames!.add(local);
  for (const stmt of body) {
    const decl =
      stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
        ? ((stmt.declaration as SurfaceNode | null | undefined) ?? stmt)
        : stmt;
    if (decl.type === "FunctionDeclaration") {
      const id = surfaceName(decl.id as SurfaceNode | undefined);
      if (id) surface.valueNames!.add(id);
    } else if (decl.type === "VariableDeclaration") {
      for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
        for (const id of patternBindingNames(d.id as SurfaceNode | undefined)) {
          surface.valueNames!.add(id);
        }
      }
    }
  }
  // 导入的值同样在值命名空间（`typeof importedFn`）；`import type` 除外。
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type") continue;
    for (const spec of (stmt.specifiers as SurfaceNode[] | undefined) ?? []) {
      if (spec.importKind === "type") continue;
      const local = surfaceName(spec.local as SurfaceNode | undefined);
      if (local) surface.valueNames!.add(local);
    }
  }

  // ── Bug 22 / 75：模块顶层 `interface` / `type` 别名原文镜像 ──
  // 导出的（`export interface Top`）切整个 ExportNamedDeclaration（带 `export`）；
  // 未导出的私有类型（`interface Hidden`）只发声明（tsc `--declaration` 同口径）
  // ⇒ namespace 成员引用私有类型时产物里可解析（否则 TS2304）。
  const noteTypeDecl = (slice: SurfaceNode, decl: SurfaceNode): void => {
    // 切 `slice`（`export interface X` 要带 export；`decl` 只是内层声明）
    const text = surfaceSlice(source, slice);
    if (text) surface.typeDeclarations!.push(text);
    // BUG-005：类型名要进「产物里可解析」的名字面（形参 / 字段注解可引用它）。
    const name = surfaceName(decl.id as SurfaceNode | undefined);
    if (name) surface.typeNames!.add(name);
  };
  for (const stmt of body) {
    if (stmt.type === "TSInterfaceDeclaration" || stmt.type === "TSTypeAliasDeclaration") {
      noteTypeDecl(stmt, stmt);
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const d = stmt.declaration as SurfaceNode | null | undefined;
      if (d?.type === "TSInterfaceDeclaration" || d?.type === "TSTypeAliasDeclaration") {
        noteTypeDecl(stmt, d);
      }
    }
  }

  // BUG-217：类型声明的局部导出别名 → `export { I as IA };` / `export type { … };`。
  // 只补**类型名**：函数 / 类 / 值 / namespace 的别名由各自发射通道补
  // （`dtsExtraExportLines` / `dtsValueDeclarations`），这里再发就是重复声明。
  {
    const typeAliasLines: string[] = [];
    for (const group of pendingTypeAliasExports) {
      const parts: string[] = [];
      for (const a of group.aliases) {
        if (surface.typeNames!.has(a.local) !== true) continue;
        if (
          classDecls.has(a.local) ||
          surface.values.has(a.local) ||
          surface.namespaces!.has(a.local)
        ) {
          continue;
        }
        parts.push(
          a.local === a.exported
            ? exportNameRepr(a.exported)
            : `${exportNameRepr(a.local)} as ${exportNameRepr(a.exported)}`,
        );
      }
      if (parts.length > 0) {
        typeAliasLines.push(`export ${group.typeOnly ? "type " : ""}{ ${parts.join(", ")} };`);
      }
    }
    if (typeAliasLines.length > 0) surface.typeExportAliases = typeAliasLines;
  }

  // ── 全局增强原文镜像：模块级 `declare global { … }` / `declare namespace X` ──
  // BUG-167：全局增强在 AST 里是一个**裸 `TSModuleDeclaration`**——没有
  // `ExportNamedDeclaration` 外壳（`kind: "global"`，无 id 名可登记），也不是
  // 类型别名 ⇒ 上面五趟顶层扫描（类 / 导入面 / 导出名表 / 值声明 / interface
  // 与 type 镜像）**一趟都不命中** ⇒ 整块静默消失：消费方 `window.<member>`、
  // `NodeJS.ProcessEnv` 的增强读不到（TS2339），而 `nudo export` 照样报绿。
  // tsc `--declaration` 对同一写法原样保留（`declare global { … }` 在 dts 里
  // 是同形事实）⇒ 这里同口径原文镜像。`declare namespace NodeJS { … }` 这类
  // ambient 命名空间增强同样是裸 `TSModuleDeclaration`（`declare: true`），
  // 同一条通道落地（否则整块丢；成员多寡不影响，切的是整条语句）。
  const isGlobalAugmentation = (n: SurfaceNode): boolean =>
    n.kind === "global" ||
    n.global === true ||
    (n.declare === true && surfaceName(n.id as SurfaceNode | undefined) === "global");
  for (const stmt of body) {
    if (stmt.type !== "TSModuleDeclaration") continue;
    if (!isGlobalAugmentation(stmt) && stmt.declare !== true) continue;
    const text = surfaceSlice(source, stmt);
    if (text) surface.typeDeclarations!.push(text);
  }

  // BUG-008：只有「这个值就是模块本身」时才是 `export =`。
  //
  // 排除项（都是 TS2309「export assignment 不得与其他导出元素共存」）：
  // - `module.exports` 之外还有具名值导出（`exports.x = …` / `export const`）；
  // - 镜像进产物的 **`export interface` / `export type`** —— BUG-005 让本地
  //   类型原文镜像进同一份产物后，`export =` 与它共存会让产物直接编译失败
  //   （`error TS2309`），而 `nudo export` 仍 exit 0。
  //   这类混用源码在 TS 自己的 `--declaration` 里本来就只有具名导出
  //   （`module.exports = C` 只是对全局 `module` 的赋值，不构成声明面事实）
  //   ⇒ 保持既有 ESM 投影，不猜 `export =`（与 TS 同答案，且产物可编译）。
  const hasExportedTypeDecl = (surface.typeDeclarations ?? []).some((t) =>
    /^\s*export\b/.test(t),
  );
  /**
   * 注解原文在产物里是否可解析（值声明 / CJS 函数成员共用；与类字段 /
   * 形参同一判据，落实在此处是因为 `typeNames` 已扫描完毕）。
   */
  const isResolvableValueType = (name: string, valuePosition?: boolean): boolean =>
    TS_TYPE_TOKENS.has(name) ||
    isRuntimeGlobalCtorName(name) ||
    classDecls.has(name) ||
    imports.has(name) ||
    surface.typeNames!.has(name) ||
    (valuePosition === true && surface.valueNames!.has(name));
  /**
   * BUG-110：`module.exports = f` 之后 `f.version = …` / `f.helper = function…`
   * 是**函数对象上的成员写**。TS 的可调用模块用声明合并表达：
   * `declare function f` + `declare namespace f { … }`。此前 CJS 槽采集只收
   * `exports.x` / `module.exports.x`，这些 `f.<prop>` 一条都不进产物 ⇒
   * 消费方 `f.version` / `f.helper(2)` 全部 TS2339。
   */
  const exportEqualsMembersOf = (local: string): string[] => {
    if (local === "") return [];
    const out: string[] = [];
    for (const stmt of body) {
      if (stmt.type !== "ExpressionStatement") continue;
      const e = stmt.expression as SurfaceNode | undefined;
      if (e?.type !== "AssignmentExpression" || e.operator !== "=") continue;
      const left = e.left as SurfaceNode | undefined;
      if (left?.type !== "MemberExpression" || left.computed === true) continue;
      const obj = left.object as SurfaceNode | undefined;
      if (obj?.type !== "Identifier" || obj.name !== local) continue;
      const name = surfaceName(left.property as SurfaceNode | undefined);
      if (!name || !isJsBindingIdent(name)) continue;
      const init = e.right as SurfaceNode | undefined;
      if (init?.type === "FunctionExpression" || init?.type === "ArrowFunctionExpression") {
        const rawParams = (init.params as SurfaceNode[] | undefined) ?? [];
        const params = surfaceParamNames(rawParams)
          .map((p, i) =>
            paramDeclOf(
              p,
              i,
              safeFieldTypeAnnotation(nodeAnnotationText(rawParams[i], source), isResolvableValueType),
            ),
          )
          .join(", ");
        // 成员函数的返回注解同样保真（`f.helper = function (x: number): number`）
        const ret =
          safeFieldTypeAnnotation(nodeAnnotationText(init, source), isResolvableValueType) ??
          "unknown";
        out.push(`function ${name}(${params}): ${ret};`);
      } else {
        out.push(`const ${name}: ${valueTypeTextOfInit(init, source)};`);
      }
    }
    return out;
  };
  if (
    exportEqualsCandidate !== undefined &&
    surface.exportBindings.size === 1 &&
    !hasExportedTypeDecl
  ) {
    const members = exportEqualsMembersOf(exportEqualsCandidate);
    surface.exportEquals = {
      local: exportEqualsCandidate,
      ...(members.length > 0 ? { members } : {}),
    };
  }

  // ── Bug 57：函数 / 方法级类型形参子句（普查名 → `<T>` 原文）──
  const noteTypeParams = (key: string, fnNode: SurfaceNode | undefined): void => {
    const text = typeParamClauseText(fnNode?.typeParameters as SurfaceNode | undefined, source);
    if (text) surface.typeParamClauses!.set(key, text);
  };
  // BUG-193：形参默认值的类型证据（普查名 → 逐位类型文本）
  const noteParamDefaults = (key: string, fnNode: SurfaceNode | undefined): void => {
    const defaults = defaultParamTypeTexts(
      fnNode?.params as SurfaceNode[] | undefined,
      source,
    );
    if (defaults !== undefined) surface.paramDefaults!.set(key, defaults);
  };
  for (const stmt of body) {
    const inner = stmt.declaration as SurfaceNode | null | undefined;
    const d = inner ?? stmt;
    if (d.type === "FunctionDeclaration" || d.type === "TSDeclareFunction") {
      const name =
        surfaceName(d.id as SurfaceNode | undefined) ??
        (stmt.type === "ExportDefaultDeclaration" ? "default" : undefined);
      if (name) {
        noteTypeParams(name, d);
        noteParamDefaults(name, d);
      }
    } else if (d.type === "ArrowFunctionExpression" || d.type === "FunctionExpression") {
      // 匿名 `export default <T,>(…) => …` 的普查名是 "default"
      noteTypeParams("default", d);
      noteParamDefaults("default", d);
    } else if (d.type === "VariableDeclaration") {
      for (const dd of (d.declarations as SurfaceNode[] | undefined) ?? []) {
        const name = surfaceName(dd.id as SurfaceNode | undefined);
        const init = dd.init as SurfaceNode | undefined;
        if (
          name &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          noteTypeParams(name, init);
          noteParamDefaults(name, init);
        }
      }
    } else if (d.type === "ClassDeclaration") {
      const clsName = surfaceName(d.id as SurfaceNode | undefined);
      if (!clsName) continue;
      for (const raw of (d.body as { body?: SurfaceNode[] } | undefined)?.body ?? []) {
        const m = raw as SurfaceNode;
        const key = surfaceName(m.key as SurfaceNode | undefined);
        if (!key) continue;
        const fnNode = surfaceMemberFn(m);
        if (
          m.type === "ClassMethod" ||
          m.type === "MethodDefinition" ||
          m.type === "TSDeclareMethod" ||
          m.type === "ClassProperty"
        ) {
          noteTypeParams(`${clsName}.${key}`, fnNode);
          noteParamDefaults(`${clsName}.${key}`, fnNode);
        }
      }
    }
  }

  // ── BUG-190：同模块 `enum` 的类型名也是产物里的**可解析类型** ──
  // `dtsValueDeclarations` 会为导出 enum 发 `declare enum Color { … }`，但
  // 「注解里的名字在产物里是否可解析」的判据只登记 interface / type 别名
  // ⇒ `paint(c: Color)` 被误判成「type not declared in this module」整条丢弃
  // （形参 / 字段回落 unknown，返回位靠声明注解回落）。两张清单同源：
  // 只有**会被发射**的导出 enum 才算可解析（未导出 enum 在产物里没有声明，
  // 放行会 TS2304）。必须在类面扫描之前登记（类字段注解用同一判据）。
  for (const [local, value] of surface.values) {
    if (value.kind !== "enum") continue;
    if (dtsExportNamesOf(surface, local).length === 0) continue;
    surface.typeNames!.add(local);
  }

  // ── 类面（导出名 + 成员） ──
  // 可解析判据：本地类 / 已 import 的名字 / TS 全局构造器名（与 `brandTSType`
  // 同一口径）——只在这种名字上放行 `extends`。
  // Bug 49：namespace 限定名 `NS.Base` 的根名是命名空间导入 ⇒ 也算可解析
  // （`projectModuleDtsInner` 会补 `import * as NS`）。
  const isResolvableName = (name: string, valuePosition?: boolean): boolean => {
    if (name.includes(".")) {
      const root = name.split(".")[0]!;
      return surface.namespaceImports!.has(root) || imports.has(root);
    }
    // BUG-005：本地 interface / type 别名同样可解析（会被原文镜像进产物）。
    // TS 内建 token（`number` / `string` / 联合里的 `null` …）必须先放行——
    // 这个判据同时服务**字段注解**，漏掉它任何 `x: number` 都会被丢。
    return (
      TS_TYPE_TOKENS.has(name) ||
      classDecls.has(name) ||
      imports.has(name) ||
      isRuntimeGlobalCtorName(name) ||
      surface.typeNames?.has(name) === true ||
      (valuePosition === true && surface.valueNames!.has(name))
    );
  };
  for (const [local, decl] of classDecls) {
    const scanned = scanClassSurface(decl, isResolvableName, source);
    // BUG-193：类方法的默认值证据挂到模块面（分析面签名 `C.m` 的形参位兜底）
    for (const m of [...scanned.instanceMethods, ...scanned.staticMethods]) {
      if (m.paramDefaults !== undefined) {
        surface.paramDefaults!.set(`${local}.${m.name}`, m.paramDefaults);
      }
    }
    // BUG-189：一个本地绑定可同时是具名导出与 default 导出 ⇒ 全部记下，
    // 主形态取第一个（具名优先），其余在声明后逐条补 `export { … as … }`。
    const exportNames = dtsExportNamesOf(surface, local);
    const exportName = exportNames[0];
    surface.classes.set(local, {
      ...scanned,
      ...(exportName !== undefined ? { exportName } : {}),
      ...(exportNames.length > 0 ? { exportNames } : {}),
      isDefault: exportName === "default",
      ...(classExpressions.has(local) ? { isExpression: true } : {}),
    });
  }
  return surface;
}

/** 模块面 dts 投影结果 */
