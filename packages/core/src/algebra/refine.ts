/**
 * 源内契约解析：唯一形态
 *
 *   @nudo:contract <param> <constraint>    参数契约（挂入口 Abs，参与运算）
 *   @nudo:contract return <constraint>     返回契约（推断返回值 ⊭ 时红）
 *
 * 不叫 requires：那只是「校验挡板」。
 * contract 表示约束是类型的一部分——Abs = shape × term × **pred** × conf，
 * pred 会流入代数（x>0 ⇒ x+1>1），不只是调用点挡一下。
 *
 * constraint 来自 *.nudo.js 导出的模板（number().gt(0) 等），
 * 由 /// @nudo:import { delay } from "./delay.nudo.js" 引入。
 * 不支持写 `x > 0`（绑死参数名）。
 * 不用 JSDoc @param/@return：那是类型注解语法。
 *
 * 侧车加载：Babel 语句级改写（多行 import / 注释与字符串里的同形文本不误伤）、
 * 相对 .nudo.js/.nudo.ts 经 loadModule 递归求值、环检测、执行失败改诊断
 * （nudo:interface-load / nudo:interface-cycle，不再静默吞错）。
 */

import type { Pred } from "./pred.ts";
import { v as termVar } from "./term.ts";
import { parseSource } from "./parse-source.ts";
import { hashSource } from "./hash-source.ts";
import { stripStringsKeepComments } from "./code-text.ts";
// leaf 模块：load-deps-fp.ts 已 import 本文件（extractNudoImports），
// 反向 import 会成环——路径函数从 sidecar-path.ts 单源取用
import { isNodeModulesPath, resolveDepPath } from "./sidecar-path.ts";
// 诊断 side-channel 共享原语（与 interface 通道同一实现，leaf 无环）
import { createScopedDiagChannel } from "./diag-channel.ts";
import { registerCollectorScopeParticipant } from "./collector-scope.ts";
// D5=F1：指令抽取单源在 directive-scan.ts（G2 作用域 + 文法），本文件只消费
import {
  extractNudoImportRecords,
  fnDirectiveCommentLines,
  scanAssumeSegments,
  scanBudgetDecl,
  scanContractSegments,
  scanMalformedNudoImports,
  scanThrowsDecl,
} from "./directive-scan.ts";
import type { ImportDeclaration } from "@babel/types";
import {
  type NudoConstraint,
  isNudoConstraint,
  instantiateConstraint,
  CONSTRAINT_BUILDERS,
} from "./constraint.ts";

/** `/// @nudo:import { delay, percent } from "./delay.nudo.js"` */
export type NamedImport = { names: string[]; spec: string };

/** default / 未识别 `@nudo:import` 形态 → nudo:contract-syntax（不再静默丢弃） */
function diagnoseMalformedNudoImports(source: string): void {
  for (const bad of scanMalformedNudoImports(source)) {
    if (bad === "malformed-default") {
      collectDiag({
        code: "nudo:contract-syntax",
        message: `Default @nudo:import is not supported (use named { a, b } or namespace * as ns)`,
      });
    } else {
      collectDiag({
        code: "nudo:contract-syntax",
        message: `Unrecognized @nudo:import form (expected { names } from "path" or * as ns from "path")`,
      });
    }
  }
}

/**
 * `@nudo:import` 命名/namespace 导入（D5=F1：文法在 directive-scan 单源）。
 * `names` 是本地绑定名（契约引用名）；别名→导出名的映射留在
 * `NudoImportRecord.importedOfLocal`（查表口 collectConstraints 消费）。
 */
export function extractNudoImports(source: string): NamedImport[] {
  diagnoseMalformedNudoImports(source);
  return extractNudoImportRecords(source).map((rec) => ({
    names: rec.names,
    spec: rec.spec,
  }));
}

// ---------------------------------------------------------------------------
// 侧车加载诊断（side-channel）
//
// 先例 setCallCollector：check 报告之外的结构化旁路。侧车执行失败 / 导出
// 形式不识别原先 `catch { continue }` 静默丢契约，Phase 1 起必须可见。
// ---------------------------------------------------------------------------

/** refine 侧车加载诊断（severity 由消费方按 code 定档，形状对齐 Issue 子集） */
export type RefineDiag = { code: string; message: string; file?: string };

/** 防长会话无界增长；消费方 takeRefineDiags 按批取走 */
const MAX_REFINE_DIAGS = 1024;
/** 诊断 side-channel 单一定义：diag-channel.ts 共享原语（seq/since 语义见彼处）。
 *  作用域化：runWithCollectorScope 内空缓冲/seq 归零——交错分析的条目
 *  不再混进同一缓冲（await 窗口偷诊断根因）；无作用域 = fallback 全局通道。 */
const refineDiagChannel = createScopedDiagChannel<RefineDiag>(MAX_REFINE_DIAGS);
registerCollectorScopeParticipant((body) => refineDiagChannel.runScoped(body));

/** 设置诊断观察者（null 清除）；缓冲照常累积，takeRefineDiags 取走 */
export function setRefineDiagCollector(fn: ((d: RefineDiag) => void) | null): void {
  refineDiagChannel.setCollector(fn);
}

/** 当前诊断累计序号（since 锚） */
export function refineDiagCount(): number {
  return refineDiagChannel.count();
}

/** 取走已收集的诊断（收集即清空） */
export function takeRefineDiags(): RefineDiag[] {
  return refineDiagChannel.take();
}

/** 只取走 seq > since 的增量（工具面防窃取在途诊断；全量 take 的 since 版） */
export function takeRefineDiagsSince(since: number): RefineDiag[] {
  return refineDiagChannel.takeSince(since);
}

function collectDiag(d: RefineDiag): void {
  refineDiagChannel.emit(d);
}

/** 侧车模块错误：code ∈ nudo:interface-cycle | nudo:interface-load */
export class NudoSidecarError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "NudoSidecarError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// *.nudo.js 受控执行：Babel 语句级改写（不再正则剥壳）
// ---------------------------------------------------------------------------

/**
 * 侧车可注入的构建器：`@nudojs/core` 与一切裸包名 import 一律注入。
 * 名单单源在 constraint.ts 的 CONSTRAINT_BUILDERS——新增构建器只改那一处。
 */
const sidecarInjects: Record<string, unknown> = CONSTRAINT_BUILDERS;

function isSidecarSpec(spec: string): boolean {
  return spec.endsWith(".nudo.js") || spec.endsWith(".nudo.ts");
}

/** import 绑定：named（含 alias）/ namespace / default（侧车无默认导出概念） */
type SidecarImportName = {
  local: string;
  imported?: string;
  ns?: boolean;
};

type SidecarImport = { spec: string; names: SidecarImportName[] };

function sidecarImportNames(stmt: ImportDeclaration): SidecarImportName[] {
  const out: SidecarImportName[] = [];
  for (const s of stmt.specifiers) {
    if (s.type === "ImportSpecifier") {
      out.push({
        local: s.local.name,
        imported: s.imported.type === "Identifier" ? s.imported.name : s.imported.value,
      });
    } else if (s.type === "ImportNamespaceSpecifier") {
      out.push({ local: s.local.name, ns: true });
    } else {
      out.push({ local: s.local.name });
    }
  }
  return out;
}

/**
 * Babel 语句级改写：
 * - import 全部剥离（构建器注入 / 相对 .nudo 递归的绑定由 prologue 生成）；
 * - `export const` 剥 export、收集导出名；其余 export 形式剥除 + 收集
 *   nudo:interface-load 诊断（loader 只认 export const）；
 * - `.nudo.ts` 入口额外剥除 TS 语法（类型注解/类型声明/as/satisfies/
 *   非空断言/泛型参数）——Babel 的 TS 节点区间含冒号（`": number"`），
 *   纯区间切除即得合法 JS；不带注解的 JS 风格 .nudo.ts 天然零切除；
 * - 只动 AST 节点区间——注释/字符串里的同形文本不参与（正则剥壳的误伤源）。
 */
function rewriteSidecarSource(
  src: string,
  fromFile: string | undefined,
): {
  code: string;
  exportPairs: Array<{ key: string; expr: string }>;
  imports: SidecarImport[];
  bindingInfos: Map<string, SidecarBindingInfo>;
} {
  // .nudo.ts 需要未剥除 TS 的 AST（keepTs）——类型注解/声明的区间才能切除；
  // 默认路径照旧走剥除（全链消费方依赖剥除后形态）
  const keepTs = fromFile?.endsWith(".nudo.ts") === true;
  const ast = parseSource(src, keepTs ? { keepTs: true } : undefined);
  const cuts: Array<{ start: number; end: number; text: string }> = [];
  /** 导出表：key = 绑定名（含 "default"），expr = 求值表达式标识符 */
  const exportPairs: Array<{ key: string; expr: string }> = [];
  const imports: SidecarImport[] = [];
  const DEFAULT_LOCAL = "__nudoDefault";

  const badExport = (what: string): void => {
    collectDiag({
      code: "nudo:interface-load",
      message: `sidecar ${what}; recognized export forms are 'export const <name> = …' and 'export default <constraint|fn>'`,
      file: fromFile,
    });
  };

  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") {
      imports.push({ spec: stmt.source.value, names: sidecarImportNames(stmt) });
      if (stmt.start != null && stmt.end != null) {
        cuts.push({ start: stmt.start, end: stmt.end, text: "" });
      }
      continue;
    }
    // `export type X = …` / `export interface X {…}`：类型声明整体移除（非坏导出）
    if (
      stmt.type === "ExportNamedDeclaration" &&
      stmt.declaration &&
      (stmt.declaration.type === "TSTypeAliasDeclaration" ||
        stmt.declaration.type === "TSInterfaceDeclaration" ||
        stmt.declaration.type === "TSEnumDeclaration")
    ) {
      if (stmt.start != null && stmt.end != null) {
        cuts.push({ start: stmt.start, end: stmt.end, text: "" });
      }
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const decl = stmt.declaration;
      if (decl?.type === "VariableDeclaration" && stmt.start != null && decl.start != null) {
        if (decl.kind === "const") {
          let simple = true;
          for (const d of decl.declarations) {
            if (d.id.type === "Identifier") exportPairs.push({ key: d.id.name, expr: d.id.name });
            else simple = false;
          }
          if (!simple) badExport("'export const' with destructuring pattern");
        } else {
          badExport(`'export ${decl.kind}'`);
        }
        cuts.push({ start: stmt.start, end: decl.start, text: "" });
        continue;
      }
      if (
        (decl?.type === "FunctionDeclaration" || decl?.type === "ClassDeclaration") &&
        stmt.start != null &&
        decl.start != null
      ) {
        const kind = decl.type === "FunctionDeclaration" ? "function" : "class";
        badExport(`'export ${kind} ${decl.id?.name ?? "(anonymous)"}'`);
        // 保留声明本体（可执行），只剥 export；**不**登记为侧车导出
        // （recognized form 只有 export const / export default）
        cuts.push({ start: stmt.start, end: decl.start, text: "" });
        continue;
      }
      // export { local as exported }（DESIGN-003 别名段，无 from）：身份=导出
      // 名，绑定=本地 const（声明本体留在 code）——登记 key=导出名 expr=local，
      // 子句整体切除。re-export（export {…} from "…"）仍整体拒绝。
      if (!stmt.source) {
        let aliasPairs = false;
        for (const spec of stmt.specifiers) {
          if (spec.type !== "ExportSpecifier") continue;
          if (spec.local.type !== "Identifier") continue;
          const key =
            spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
          if (key === undefined) continue;
          exportPairs.push({ key, expr: spec.local.name });
          aliasPairs = true;
        }
        if (aliasPairs) {
          cuts.push({ start: stmt.start!, end: stmt.end!, text: "" });
          continue;
        }
      }
      // export { … } / export { … } from "…"：无声明形式，整体移除
      badExport("'export { … }' (list / re-export)");
      if (stmt.start != null && stmt.end != null) {
        cuts.push({ start: stmt.start, end: stmt.end, text: "" });
      }
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration as
        | {
            type: string;
            id?: { name?: string } | null;
            start?: number | null;
            end?: number | null;
          }
        | undefined;
      if (
        decl &&
        (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") &&
        stmt.start != null &&
        decl.start != null
      ) {
        // export default function d() / class D：剥 export，本体可执行；
        // 同时登记本地名与 "default"（C4.4）
        if (decl.id?.name) {
          exportPairs.push({ key: decl.id.name, expr: decl.id.name });
          exportPairs.push({ key: "default", expr: decl.id.name });
        } else {
          // 匿名：包一层本地绑定
          exportPairs.push({ key: "default", expr: DEFAULT_LOCAL });
          if (decl.start != null && decl.end != null) {
            const kind = decl.type === "FunctionDeclaration" ? "function" : "class";
            cuts.push({
              start: stmt.start,
              end: decl.start,
              text: `var ${DEFAULT_LOCAL} = `,
            });
            void kind;
          }
        }
        if (decl.id?.name) {
          cuts.push({ start: stmt.start, end: decl.start, text: "" });
        }
        continue;
      }
      // export default <expr>（fn(…) / 标识符等）：var __nudoDefault = <expr>
      if (decl && stmt.start != null && decl.start != null && decl.end != null) {
        exportPairs.push({ key: "default", expr: DEFAULT_LOCAL });
        cuts.push({
          start: stmt.start,
          end: decl.start,
          text: `var ${DEFAULT_LOCAL} = `,
        });
        cuts.push({ start: decl.end, end: stmt.end ?? decl.end, text: ";" });
        continue;
      }
      badExport("'export default'");
      if (stmt.start != null && stmt.end != null) {
        cuts.push({ start: stmt.start, end: stmt.end, text: "" });
      }
      continue;
    }
    if (stmt.type === "ExportAllDeclaration") {
      badExport("'export * from …'");
      if (stmt.start != null && stmt.end != null) {
        cuts.push({ start: stmt.start, end: stmt.end, text: "" });
      }
    }
  }

  // ---- 运行时标志提取（Phase 1）：fn() 形参约束的表达式源码 ----
  // 消费端（inlay 等）以原文折叠展示，替代 pred 无损展开（lazy
  // 判别联合展开可达数万字符）。整表达式别名规范化：`import {
  // astNode as N }` 的裸 `N` → 导入名（表达式内无绑定声明，无
  // 遮蔽风险）；包裹表达式按原文展示。
  const aliasToImported = new Map<string, string>();
  const fnAliases = new Set<string>(["fn"]);
  for (const imp of imports) {
    for (const n of imp.names) {
      if (n.ns) continue;
      if (n.imported !== undefined && n.local !== undefined && n.imported !== n.local) {
        aliasToImported.set(n.local, n.imported);
      }
      if (n.imported === "fn" && n.local !== undefined) fnAliases.add(n.local);
    }
  }
  const paramTextsOfFnCall = (init: unknown): SidecarParamTexts | undefined => {
    const call = init as
      | {
          type: string;
          callee?: { type: string; name?: string };
          arguments?: Array<{
            type: string;
            start?: number | null;
            end?: number | null;
            properties?: Array<{
              type: string;
              computed?: boolean;
              key?: { type: string; name?: string; value?: string };
              value?: {
                type: string;
                name?: string;
                start?: number | null;
                end?: number | null;
              };
            }>;
          }>
        }
      | undefined;
    if (!call || call.type !== "CallExpression") return undefined;
    if (
      call.callee?.type !== "Identifier" ||
      !fnAliases.has(call.callee.name ?? "")
    ) {
      return undefined;
    }
    const first = call.arguments?.[0];
    if (!first || first.type !== "ObjectExpression") return undefined;
    const texts = new Map<string, string>();
    for (const prop of first.properties ?? []) {
      if (prop.type !== "ObjectProperty" || prop.computed) continue;
      const key =
        prop.key?.type === "Identifier"
          ? prop.key.name
          : prop.key?.type === "StringLiteral"
            ? prop.key.value
            : undefined;
      if (key === undefined) continue;
      const v = prop.value;
      if (!v || v.start == null || v.end == null) continue;
      texts.set(
        key,
        v.type === "Identifier" && aliasToImported.has(v.name ?? "")
          ? aliasToImported.get(v.name ?? "")!
          : src.slice(v.start, v.end),
      );
    }
    return texts;
  };
  const paramInfosByLocal = new Map<string, SidecarBindingInfo>();
  const collectVarFns = (
    decls: Array<{
      id?: { type: string; name?: string };
      init?: unknown;
      loc?: { start?: { line?: number } };
    }>,
  ): void => {
    for (const d of decls) {
      if (d?.id?.type !== "Identifier" || d.id.name === undefined) continue;
      const texts = paramTextsOfFnCall(d.init);
      if (texts)
        paramInfosByLocal.set(d.id.name, {
          texts,
          line: d.loc?.start?.line ?? 1,
        });
    }
  };
  for (const stmt of ast.program.body) {
    // export const name = fn({…})：顶层 stmt 是 ExportNamedDeclaration
    if (
      stmt.type === "ExportNamedDeclaration" &&
      (stmt as { declaration?: { type: string } }).declaration?.type ===
        "VariableDeclaration"
    ) {
      collectVarFns(
        (
          (stmt as {
            declaration?: {
              declarations?: Array<{
                id?: { type: string; name?: string };
                init?: unknown;
                loc?: { start?: { line?: number } };
              }>;
            };
          }).declaration?.declarations ?? []
        ),
      );
    } else if (stmt.type === "VariableDeclaration") {
      // const local = fn({…})（经 export { local as exported } 桥接）
      collectVarFns(
        (
          stmt as {
            declarations?: Array<{
              id?: { type: string; name?: string };
              init?: unknown;
              loc?: { start?: { line?: number } };
            }>;
          }
        ).declarations ?? [],
      );
    } else if (stmt.type === "ExportDefaultDeclaration") {
      // export default fn({…})：登记在 DEFAULT_LOCAL 键
      // （exportPairs 的 expr 即改写后的 __nudoDefault）
      const decl = (stmt as { declaration?: unknown }).declaration;
      const texts = paramTextsOfFnCall(decl);
      if (texts)
        paramInfosByLocal.set(DEFAULT_LOCAL, {
          texts,
          line:
            (stmt as { loc?: { start?: { line?: number } } }).loc?.start
              ?.line ?? 1,
        });
    }
  }
  // 登记键 = 导出键：exportPairs 把 `export { local as exported }` 桥接为
  // exported → local；`export const name = fn(…)` 的 key/expr 同名。
  const bindingInfos = new Map<string, SidecarBindingInfo>();
  for (const p of exportPairs) {
    const info = paramInfosByLocal.get(p.expr);
    if (info) bindingInfos.set(p.key, info);
  }

  // .nudo.ts：收集 TS 子语法区间（类型注解/类型声明/as/!/泛型）一并切除。
  // 区间与语句级 cuts 可能重叠（如 declare 语句）——排序后合并重叠段。
  if (fromFile?.endsWith(".nudo.ts")) {
    for (const cut of collectTsSyntaxCuts(ast.program, src)) {
      cuts.push({ start: cut.start, end: cut.end, text: "" });
    }
  }

  cuts.sort((a, b) => a.start - b.start);
  // 仅合并「纯删除」（text === ""）重叠区间；带替换文本的 cut 不得吞掉
  // （export default → `var __nudoDefault = ` 等）。套入原文 + 替换文本。
  const merged: Array<{ start: number; end: number; text: string }> = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end && last.text === "" && c.text === "") {
      last.end = Math.max(last.end, c.end);
    } else {
      merged.push({ start: c.start, end: c.end, text: c.text });
    }
  }
  let code = "";
  let pos = 0;
  for (const c of merged) {
    if (c.start < pos) continue; // 与前一非空替换重叠：跳过（宁可少删，不可坏代码）
    code += src.slice(pos, c.start) + c.text;
    pos = c.end;
  }
  code += src.slice(pos);
  return { code, exportPairs, imports, bindingInfos };
}

/** 纯类型语句：整体删除（运行时无对应语义；enum 的反向映射本引擎不支持） */
const TS_STMT_CUT_TYPES = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "TSDeclareFunction",
  "TSModuleDeclaration",
  "TSImportEqualsDeclaration",
]);

/**
 * TS 子语法区间收集（节点区间均含标点：TSTypeAnnotation 含冒号、
 * TSTypeParameterDeclaration 含尖括号——探针实测 Babel 区间语义）。
 */
function collectTsSyntaxCuts(
  node: unknown,
  src: string,
  cuts: Array<{ start: number; end: number }> = [],
): Array<{ start: number; end: number }> {
  if (!node || typeof node !== "object") return cuts;
  if (Array.isArray(node)) {
    for (const x of node) collectTsSyntaxCuts(x, src, cuts);
    return cuts;
  }
  const o = node as Record<string, unknown> & {
    type?: string;
    start?: number;
    end?: number;
  };
  if (typeof o.start === "number" && typeof o.end === "number") {
    if (typeof o.type === "string" && TS_STMT_CUT_TYPES.has(o.type)) {
      cuts.push({ start: o.start, end: o.end });
      return cuts; // 整语句删除，不深入
    }
    if (o.type === "TSAsExpression" || o.type === "TSSatisfiesExpression") {
      collectTsSyntaxCuts(o.expression, src, cuts);
      const exprEnd = (o.expression as { end?: number } | undefined)?.end;
      if (typeof exprEnd === "number") cuts.push({ start: exprEnd, end: o.end });
      return cuts;
    }
    if (o.type === "TSNonNullExpression") {
      collectTsSyntaxCuts(o.expression, src, cuts);
      const exprEnd = (o.expression as { end?: number } | undefined)?.end;
      if (typeof exprEnd === "number") cuts.push({ start: exprEnd, end: o.end });
      return cuts;
    }
    if (o.type === "TSTypeAssertion") {
      collectTsSyntaxCuts(o.expression, src, cuts);
      const exprStart = (o.expression as { start?: number } | undefined)?.start;
      if (typeof exprStart === "number") cuts.push({ start: o.start, end: exprStart });
      return cuts;
    }
    // 类型注解（宿主 Identifier/Pattern/ClassProperty 等的 typeAnnotation）：
    // 宿主节点区间含注解，切除注解本体 + 可选 `?` 前缀（`x?: string`）
    const ta = o.typeAnnotation as { start?: number; end?: number } | undefined;
    if (ta && typeof ta.start === "number" && typeof ta.end === "number") {
      let start = ta.start;
      if (src[start - 1] === "?") start -= 1;
      cuts.push({ start, end: ta.end });
    }
    // 返回类型注解（函数/箭头）：区间同样含冒号
    const rt = o.returnType as { start?: number; end?: number } | undefined;
    if (rt && typeof rt.start === "number" && typeof rt.end === "number") {
      cuts.push({ start: rt.start, end: rt.end });
    }
    // 泛型参数声明 `<T extends …>` / 泛型实参 `f<number>(…)`
    for (const key of ["typeParameters", "typeArguments"] as const) {
      const tp = o[key] as { start?: number; end?: number } | undefined;
      if (tp && typeof tp.start === "number" && typeof tp.end === "number") {
        cuts.push({ start: tp.start, end: tp.end });
      }
    }
    // 无注解的可选参数 `x?`（`?` 紧跟标识符，宿主区间不含）
    if (o.optional === true && !ta && typeof o.end === "number" && src[o.end] === "?") {
      cuts.push({ start: o.end, end: o.end + 1 });
    }
    // declare 修饰（`declare const x: …` / `declare class`）：整语句删除
    if (o.declare === true) {
      cuts.push({ start: o.start, end: o.end });
      return cuts;
    }
  }
  for (const key of Object.keys(o)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") {
      continue;
    }
    collectTsSyntaxCuts(o[key], src, cuts);
  }
  return cuts;
}

/** 侧车参数文本注册（路径 → 内容hash → 导出键 → 表达式原文）。
 *  execSidecar 成功求值后登记；exec 缓存命中（同内容侧车在
 *  不同路径——复制的契约）时不重跑 execSidecar，由
 *  execNudoModuleCached 在命中路径补登记，否则第二个侧车
 *  路径查不到折叠文本、回落 pred 全展。 */
function registerSidecarParamTexts(
  sidecarPath: string,
  contentKey: string,
  infos: Map<string, SidecarBindingInfo>,
): void {
  let perPath = sidecarParamTextsRegistry.get(sidecarPath);
  if (perPath === undefined) {
    perPath = new Map();
    sidecarParamTextsRegistry.set(sidecarPath, perPath);
    if (sidecarParamTextsRegistry.size > MAX_SIDECAR_PARAM_TEXTS_PATHS) {
      const oldest = sidecarParamTextsRegistry.keys().next().value;
      if (oldest !== undefined) sidecarParamTextsRegistry.delete(oldest);
    }
  }
  perPath.set(contentKey, infos);
  if (perPath.size > MAX_SIDECAR_PARAM_TEXTS_VERSIONS) {
    const oldest = perPath.keys().next().value;
    if (oldest !== undefined) perPath.delete(oldest);
  }
}

/**
 * 执行侧车模块（真实 JS + 注入构建器，不编译内部 IR）：
 * - `@nudojs/core` / 裸包名 → 注入 sidecarInjects（alias/namespace 走
 *   `__nudoInjects` prologue；var 声明与注入参数同名可共存）；
 * - 相对 `.nudo.js`/`.nudo.ts` → loadModule 递归求值，结果经 `__nudoDeps`
 *   传入（共享注入）；无 loadModule / load miss → 收集 nudo:interface-load
 *   （unresolvable），绑定 undefined 部分求值；
 * - spec 链成环 → throw NudoSidecarError(nudo:interface-cycle，消息带链)。
 *
 * opts.fromFile 语义 = 该侧车自身的路径（相对 spec 解析基准 + 环检测链起点）。
 */
function execSidecar(
  src: string,
  opts: RefineResolveOpts | undefined,
  chain: string[],
  preloaded: ReadonlyMap<string, string | undefined>,
): {
  exports: Record<string, unknown>;
  bindingInfos: Map<string, SidecarBindingInfo>;
} {
  const fromFile = opts?.fromFile;
  const { code, exportPairs, imports, bindingInfos } = rewriteSidecarSource(src, fromFile);
  const prologue: string[] = [];
  const deps: Record<string, unknown> = {};

  for (const imp of imports) {
    const relative = imp.spec.startsWith(".") || imp.spec.startsWith("/");
    if (!relative) {
      // 裸包名 / @nudojs/core：注入
      for (const n of imp.names) {
        if (n.ns) {
          // namespace import 绑成整个 inject 表会静默把 fs/path 等本地名
          // 变成构建器袋——显式诊断，不再静默错绑
          collectDiag({
            code: "nudo:interface-load",
            message: `sidecar namespace import '${n.local}' from '${imp.spec}' is not supported (import named builders only)`,
            file: fromFile,
          });
          prologue.push(`var ${n.local} = __nudoInjects;`);
        } else if (n.imported !== undefined) {
          // 自有属性判定：`in` 会命中 Object.prototype（toString 等）——
          // 诊断被吞 + __nudoInjects 裸读把原生函数绑进侧车执行域
          const hasOwnInject = Object.hasOwn(sidecarInjects, n.imported);
          if (!hasOwnInject) {
            collectDiag({
              code: "nudo:interface-load",
              message: `sidecar import '{ ${n.imported} }' from '${imp.spec}' is not an injected builder`,
              file: fromFile,
            });
            prologue.push(`var ${n.local} = undefined;`);
          } else if (n.local !== n.imported) {
            // 同名注入名由函数参数绑定；alias 走 __nudoInjects（hasOwn 已证自有键）
            prologue.push(`var ${n.local} = __nudoInjects[${JSON.stringify(n.imported)}];`);
          }
        } else {
          // default import：侧车无默认导出概念——显式诊断（不再静默 undefined）
          collectDiag({
            code: "nudo:interface-load",
            message: `sidecar default import '${n.local}' from '${imp.spec}' has no default export to bind (sidecars export named constraints only)`,
            file: fromFile,
          });
          prologue.push(`var ${n.local} = undefined;`);
        }
      }
      continue;
    }
    const load = opts?.loadModule;
    if (!load || !fromFile) {
      collectDiag({
        code: "nudo:interface-load",
        message: `sidecar import '${imp.spec}' is unresolvable (no loadModule for relative specifier)`,
        file: fromFile,
      });
      for (const n of imp.names) deps[n.local] = undefined;
      continue;
    }
    if (!isSidecarSpec(imp.spec)) {
      collectDiag({
        code: "nudo:interface-load",
        message: `sidecar import '${imp.spec}' unsupported: relative imports must target .nudo.js/.nudo.ts`,
        file: fromFile,
      });
      for (const n of imp.names) deps[n.local] = undefined;
      continue;
    }
    const canonical = resolveDepPath(fromFile, imp.spec);
    if (isNodeModulesPath(canonical)) {
      collectDiag({
        code: "nudo:interface-load",
        message: `sidecar import '${imp.spec}' resolves into node_modules (${canonical}); ambient sidecar loading never crosses node_modules`,
        file: fromFile,
      });
      for (const n of imp.names) deps[n.local] = undefined;
      continue;
    }
    if (chain.includes(canonical)) {
      throw new NudoSidecarError(
        "nudo:interface-cycle",
        `sidecar import cycle: ${[...chain, canonical].join(" → ")}`,
      );
    }
    const depSrc = preloaded.has(canonical) ? preloaded.get(canonical) : load(imp.spec, fromFile);
    if (depSrc === undefined) {
      collectDiag({
        code: "nudo:interface-load",
        message: `sidecar import '${imp.spec}' is unresolvable (loadModule returned no source)`,
        file: fromFile,
      });
      for (const n of imp.names) deps[n.local] = undefined;
      continue;
    }
    const depOut = execSidecar(
      depSrc,
      { loadModule: load, fromFile: canonical },
      [...chain, canonical],
      preloaded,
    );
    const depExports = depOut.exports;
    for (const n of imp.names) {
      if (n.ns) {
        deps[n.local] = depExports;
      } else if (n.imported !== undefined) {
        // 自有属性判定（同注入分支）：原型名不得当侧车导出，miss 绑 undefined
        if (Object.hasOwn(depExports, n.imported)) {
          deps[n.local] = depExports[n.imported];
        } else {
          collectDiag({
            code: "nudo:interface-load",
            message: `sidecar '${imp.spec}' has no export '${n.imported}'`,
            file: fromFile,
          });
          deps[n.local] = undefined;
        }
      } else {
        // 相对侧车 default import：侧车只收集 named export，default 恒空
        collectDiag({
          code: "nudo:interface-load",
          message: `sidecar default import '${n.local}' from '${imp.spec}' has no default export (sidecars export named constraints only)`,
          file: fromFile,
        });
        deps[n.local] = Object.hasOwn(depExports, "default") ? depExports.default : undefined;
      }
    }
  }

  for (const local of Object.keys(deps)) {
    prologue.push(`var ${local} = __nudoDeps[${JSON.stringify(local)}];`);
  }

  const returnObj = exportPairs
    .map((p) =>
      p.key === p.expr ? p.key : `${JSON.stringify(p.key)}: ${p.expr}`,
    )
    .join(", ");
  const body = `${prologue.length > 0 ? `${prologue.join("\n")}\n` : ""}${code}\nreturn { ${returnObj} };`;
  const fn = new Function(
    ...Object.keys(sidecarInjects),
    "__nudoInjects",
    "__nudoDeps",
    body,
  );
  const result = fn(...Object.values(sidecarInjects), sidecarInjects, deps) as Record<string, unknown>;
  // 绑定信息登记：成功求值后按侧车 canonical 路径 + 内容
  // hash 入库（失败不登记；resetNudoModuleExecCache 同口径清除）。
  // exec 缓存命中不重登记——同内容首次求值已入库；命中路径
  // 的跨路径补登记在 execNudoModuleCached（同内容不同路径）。
  if (fromFile !== undefined && bindingInfos.size > 0) {
    registerSidecarParamTexts(fromFile, hashSource(src), bindingInfos);
  }
  return { exports: result, bindingInfos };
}

/**
 * 执行 *.nudo.js（真实 JS + 我们的构建器）。import/export 由 Babel 语句级
 * 改写：多行 named import、注释/字符串里的同形文本不误伤；相对 .nudo 递归
 * 求值；环 → throw NudoSidecarError。结果进 exec 缓存（依赖闭包内容指纹键）。
 */
export function execNudoModule(src: string, opts?: RefineResolveOpts): Record<string, unknown> {
  return execNudoModuleCached(src, opts ?? {});
}

export type RefineResolveOpts = {
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  /** 侧车自身的路径（相对 spec 解析基准 + 环检测链起点） */
  fromFile?: string;
};

/** *.nudo.js 构建器执行结果（LRU）。键 = 依赖闭包内容指纹；无 loadModule 退化为 src。
 * 值携带 bindingInfos——缓存命中（同内容侧车在不同路径）时
 * 由 execNudoModuleCached 按当前路径补登记参数折叠文本。 */
const nudoModuleExecCache = new Map<
  string,
  { exports: Record<string, unknown>; bindingInfos: Map<string, SidecarBindingInfo> }
>();
/** 执行失败缓存（#64）：同指纹失败只 exec 一次，后续调用重抛同一错误 */
const nudoModuleFailCache = new Map<string, unknown>();
const MAX_NUDO_MODULE_EXEC = 64;
/** 防病态侧车依赖图；截断时指纹不可信 → 本次不读写缓存 */
const MAX_SIDECAR_CLOSURE = 64;

/**
 * 递归收集相对 .nudo 依赖闭包（loadModule 单遍，供指纹 + exec 预载复用）。
 * 环在遍历中截断（out.has 去重）——真正执行时由 chain 抛 nudo:interface-cycle。
 */
function sidecarDepClosure(
  src: string,
  fromFile: string,
  loadModule: (spec: string, fromFile: string) => string | undefined,
  out: Map<string, string | undefined>,
): { truncated: boolean } {
  let ast: ReturnType<typeof parseSource>;
  try {
    ast = parseSource(src);
  } catch {
    return { truncated: false }; // 解析失败：执行时抛错/诊断，闭包无需补
  }
  for (const stmt of ast.program.body) {
    if (out.size >= MAX_SIDECAR_CLOSURE) return { truncated: true };
    if (stmt.type !== "ImportDeclaration") continue;
    const spec = stmt.source.value;
    if (!(spec.startsWith(".") || spec.startsWith("/"))) continue;
    if (!isSidecarSpec(spec)) continue;
    const canonical = resolveDepPath(fromFile, spec);
    if (out.has(canonical)) continue;
    let depSrc: string | undefined;
    try {
      depSrc = loadModule(spec, fromFile);
    } catch {
      depSrc = undefined; // 读失败当 miss：闭包指纹过近似安全
    }
    out.set(canonical, depSrc);
    if (depSrc === undefined) continue;
    const r = sidecarDepClosure(depSrc, canonical, loadModule, out);
    if (r.truncated) return r;
  }
  return { truncated: false };
}

/**
 * 缓存键：自身 src hash + 递归 dep 的 `路径=内容hash` 排序拼接（嵌套 import 后
 * `add.nudo.js` 的求值结果依赖 `std.nudo.js` 内容，单文件键会命中陈旧导出）。
 * 无 loadModule 时退化为 src 本身；闭包截断时不读写缓存（fail-open）。
 */
function execNudoModuleCached(src: string, opts: RefineResolveOpts): Record<string, unknown> {
  let key: string | undefined;
  let preloaded: ReadonlyMap<string, string | undefined> = new Map();
  if (opts.loadModule && opts.fromFile) {
    const deps = new Map<string, string | undefined>();
    const { truncated } = sidecarDepClosure(src, opts.fromFile, opts.loadModule, deps);
    if (!truncated) {
      const depPart = [...deps.entries()]
        .map(([p, s]) => `${p}=${s === undefined ? "miss" : hashSource(s)}`)
        .sort()
        .join(",");
      key = `${hashSource(src)}|${depPart}`;
      preloaded = deps;
    }
  } else {
    key = src; // 无 loader：单文件内容键（旧行为）
  }

  if (key !== undefined) {
    const hit = nudoModuleExecCache.get(key);
    if (hit !== undefined) {
      nudoModuleExecCache.delete(key);
      nudoModuleExecCache.set(key, hit);
      // 缓存命中不重跑 execSidecar——注册表按侧车路径键，
      // 同内容侧车在不同路径（复制的契约）时在此补登记，
      // 否则第二个路径的参数折叠文本丢失（回落 pred 全展）
      if (opts.fromFile !== undefined && hit.bindingInfos.size > 0) {
        registerSidecarParamTexts(
          opts.fromFile,
          hashSource(src),
          hit.bindingInfos,
        );
      }
      return hit.exports;
    }
    if (nudoModuleFailCache.has(key)) {
      throw nudoModuleFailCache.get(key);
    }
  }

  try {
    const { exports, bindingInfos } = execSidecar(src, opts, opts.fromFile ? [opts.fromFile] : [], preloaded);
    if (key !== undefined) {
      if (nudoModuleExecCache.size >= MAX_NUDO_MODULE_EXEC) {
        const oldest = nudoModuleExecCache.keys().next().value;
        if (oldest !== undefined) nudoModuleExecCache.delete(oldest);
      }
      nudoModuleExecCache.set(key, { exports, bindingInfos });
    }
    return exports;
  } catch (e) {
    if (key !== undefined) {
      if (nudoModuleFailCache.size >= MAX_NUDO_MODULE_EXEC) {
        const oldest = nudoModuleFailCache.keys().next().value;
        if (oldest !== undefined) nudoModuleFailCache.delete(oldest);
      }
      nudoModuleFailCache.set(key, e);
    }
    throw e;
  }
}

export function resetNudoModuleExecCache(): void {
  nudoModuleExecCache.clear();
  nudoModuleFailCache.clear();
  sidecarParamTextsRegistry.clear();
}

/**
 * 侧车 fn() 形参约束的表达式源码表（运行时标志，Phase 1）。
 * 键 = 侧车 canonical 路径 → 内容 hash → 导出键 → 绑定信息
 * （形参表达式原文 + 声明行）。内容 hash 二级键与 exec 缓存
 * 同语义：同路径不同内容（编辑 / 未保存缓冲）不串文本；
 * 同内容命中 exec 缓存时信息仍在（首次求值已登记）。
 * execSidecar 成功求值时登记，与 nudoModuleExecCache 同生命期
 * （reset 一并清除）。
 */
const sidecarParamTextsRegistry = new Map<
  string,
  Map<string, Map<string, SidecarBindingInfo>>
>();
/** 路径数上限：超出逐出最旧路径（与 nudoModuleExecCache 同口径） */
const MAX_SIDECAR_PARAM_TEXTS_PATHS = 64;
/** 单路径内容版本上限：超出逐出最旧版本（长会话反复编辑侧车） */
const MAX_SIDECAR_PARAM_TEXTS_VERSIONS = 32;

/**
 * 侧车绑定信息查询（canonical 路径 + 内容 hash + 导出键）。
 * 未登记（派生形参 / 未执行 / 已 reset / 内容不匹配）→ undefined，
 * 消费端回落 pred 全展（无原文跳转行）。
 */
export function lookupSidecarParamTexts(
  sidecarPath: string,
  srcHash: string,
  bindingName: string,
): SidecarBindingInfo | undefined {
  const perPath = sidecarParamTextsRegistry.get(sidecarPath);
  if (perPath === undefined) return undefined;
  const perHash = perPath.get(srcHash);
  if (perHash === undefined) return undefined;
  return perHash.get(bindingName);
}

/**
 * 从导入收集 name → NudoConstraint。
 * 加载失败 / 执行失败 / 导出形式不识别不再静默：收集 nudo:interface-load
 * （环 → nudo:interface-cycle）诊断后跳过该导入。
 */
function collectConstraints(
  source: string,
  opts: RefineResolveOpts,
): Map<string, NudoConstraint> {
  const map = new Map<string, NudoConstraint>();
  diagnoseMalformedNudoImports(source);
  const imports = extractNudoImportRecords(source);
  for (const imp of imports) {
    if (!opts.loadModule || !opts.fromFile) {
      // host 忘传 loader：约束会静默失效——必须报，否则 refine 无声消失
      collectDiag({
        code: "nudo:interface-load",
        message: `sidecar '${imp.spec}' not loaded: loadModule/fromFile missing from host options`,
        file: opts.fromFile,
      });
      continue;
    }
    let src: string | undefined;
    try {
      src = opts.loadModule(imp.spec, opts.fromFile);
    } catch (e) {
      collectDiag({
        code: "nudo:interface-load",
        message: `sidecar '${imp.spec}' failed to load from '${opts.fromFile}': ${e instanceof Error ? e.message : String(e)}`,
        file: opts.fromFile,
      });
      continue;
    }
    if (src === undefined) {
      collectDiag({
        code: "nudo:interface-load",
        message: `sidecar '${imp.spec}' failed to load from '${opts.fromFile}'`,
        file: opts.fromFile,
      });
      continue;
    }
    // 侧车自身的相对 import 以侧车路径为基准（而非引用方源码文件）
    const sidecarPath = resolveDepPath(opts.fromFile, imp.spec);
    let exports: Record<string, unknown>;
    try {
      exports = execNudoModuleCached(src, { loadModule: opts.loadModule, fromFile: sidecarPath });
    } catch (e) {
      if (e instanceof NudoSidecarError) {
        collectDiag({ code: e.code, message: e.message, file: opts.fromFile });
      } else {
        collectDiag({
          code: "nudo:interface-load",
          message: `sidecar '${imp.spec}' failed to execute: ${e instanceof Error ? e.message : String(e)}`,
          file: opts.fromFile,
        });
      }
      continue;
    }
    for (const name of imp.names) {
      // 命名空间：`@nudo:import * as ns` → 展开为 `ns.exportName` 供 refine 引用
      if (name.startsWith("*")) {
        const ns = name.slice(1);
        for (const [expName, v] of Object.entries(exports)) {
          if (isNudoConstraint(v)) {
            map.set(`${ns}.${expName}`, v);
          }
        }
        continue;
      }
      // `a as b`：查导出表用原始导出名 a，绑定用本地名 b（import 绑定语义
      // local ← imported；BUG-016 修复前用 b 查表 → 契约静默失效）
      const imported = imp.importedOfLocal[name] ?? name;
      // 自有属性读：toString 等键裸读踩原型链，把原型成员当侧车导出
      const v = Object.hasOwn(exports, imported) ? exports[imported] : undefined;
      if (isNudoConstraint(v)) {
        map.set(name, v);
      } else if (v === undefined) {
        collectDiag({
          code: "nudo:interface-load",
          message: `sidecar '${imp.spec}' has no export '${imported}'`,
          file: opts.fromFile,
        });
      } else {
        collectDiag({
          code: "nudo:interface-load",
          message: `sidecar '${imp.spec}' export '${imported}' is not a Nudo constraint`,
          file: opts.fromFile,
        });
      }
    }
  }
  return map;
}

/**
 * 从源码抽函数上的 @nudo:contract 行（D6=G2：作用域 = AST 最近 Function）。
 * 注释块来自 directive-scan 的 scope 绑定——与 @nudo:case 同一函数集合
 * （nested function、class method 同时可见）。
 */
function extractRefineLines(source: string, fnName: string): string[] {
  const lines = fnDirectiveCommentLines(source, fnName);
  return scanContractSegments(lines);
}

/**
 * @nudo:assume 解析段（issue #152 用户引理前提）。
 * ok：lhs ≤ rhs（`>=` 段已在解析时翻转，消费方只见 le）；
 * bad：文法外原文（`<` / `>` / `==`、字面量界等——check 发 nudo:assume-invalid）。
 * 锚定 = AST 最近 Function（与 @nudo:contract 同 D6=G2 注释块绑定）。
 */
export type AssumeSeg =
  | { kind: "ok"; lhs: string; rhs: string }
  | { kind: "bad"; raw: string };

export function extractAssumeSegs(source: string, fnName: string): AssumeSeg[] {
  // 快路径：整文件无 @nudo:assume 时免 parse 全文（与 extractRefinesFromSource 同口径）
  // 指令住注释——字符串里的同形文本不算
  if (!stripStringsKeepComments(source).includes("@nudo:assume")) return [];
  const out: AssumeSeg[] = [];
  for (const seg of scanAssumeSegments(fnDirectiveCommentLines(source, fnName))) {
    // 仅 var ≤ var（var-var 关系引理；`>=` 翻转为 le）；常数界属侧车契约文法
    const geSeg = seg.match(/^([A-Za-z_$][\w$]*)\s*>=\s*([A-Za-z_$][\w$]*)$/);
    if (geSeg) {
      out.push({ kind: "ok", lhs: geSeg[2]!, rhs: geSeg[1]! });
      continue;
    }
    const leSeg = seg.match(/^([A-Za-z_$][\w$]*)\s*<=\s*([A-Za-z_$][\w$]*)$/);
    if (leSeg) {
      out.push({ kind: "ok", lhs: leSeg[1]!, rhs: leSeg[2]! });
      continue;
    }
    out.push({ kind: "bad", raw: seg });
  }
  return out;
}

/**
 * #165：@nudo:assume 可锚定名扩展——函数体 BlockStatement **直接**子语句里
 * VariableDeclaration 的 Identifier declarator 名（const/let/var 均收，
 * 有无 init 均收）。SSA 语义：引理作用于绑定值，从定义点到作用域尾。
 * 解构模式 / 嵌套块 / for-init 的绑定名不收（保守：不进 bindable 面）；
 * 非 BlockStatement（箭头表达式体等）→ []。
 */
export function fnTopLevelLocalNames(body: unknown): string[] {
  const block = body as { type?: string; body?: unknown } | null | undefined;
  if (!block || block.type !== "BlockStatement" || !Array.isArray(block.body)) return [];
  const names: string[] = [];
  for (const stmt of block.body) {
    const decl = stmt as { type?: string; declarations?: unknown[] } | null | undefined;
    if (!decl || decl.type !== "VariableDeclaration" || !Array.isArray(decl.declarations)) {
      continue;
    }
    for (const d of decl.declarations) {
      const id = (d as { id?: { type?: string; name?: string } } | null | undefined)?.id;
      if (id?.type === "Identifier" && typeof id.name === "string") names.push(id.name);
    }
  }
  return names;
}

/**
 * 侧车 fn() 形参约束的表达式源码表（运行时标志，Phase 1 整表达式）。
 * 键 = 形参键（含 `'card.grade'` 点路径形态），值 = 表达式原文
 * （整表达式别名已规范化为导入名）。派生形参（computed key / 运行时
 * 拼对象）无静态文本 → 不登记，消费端回落 pred 全展。
 */
export type SidecarParamTexts = Map<string, string>;

/** 侧车 fn() 绑定信息：形参表达式源码表 + 绑定声明行。
 *  line = `export const name = fn(…)` 声明所在行（1-based），
 *  契约原文链接（`file://…#L<line>`）的跳转目标。 */
export type SidecarBindingInfo = {
  texts: SidecarParamTexts;
  line: number;
};

/**
 * @nudo:contract 提取条目（pred 相对 param 项）。
 * 同时保留原始 NudoConstraint（shape 字段检查用）。
 */
export type RefineEntry = {
  param: string;
  pred: Pred;
  constraint: NudoConstraint;
  /** 指令引用的约束名（`@nudo:contract x positive` 的 `positive`）；display 折叠用 */
  name?: string;
};

export function extractRefinesFromSource(
  source: string,
  fnName: string,
  opts: RefineResolveOpts = {},
): RefineEntry[] {
  // 快路径：整文件无 @nudo:contract 时免 regex 扫全文（after-edit 批量 check）
  // 指令住注释——字符串里的同形文本不算
  if (!stripStringsKeepComments(source).includes("@nudo:contract")) return [];
  const constraints = collectConstraints(source, opts);
  const out: RefineEntry[] = [];
  for (const line of extractRefineLines(source, fnName)) {
    const parts = line.split(/&&|,/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      // 约束名支持 `ns.foo` 命名空间展开（@nudo:import * as ns）
      const m = part.match(/^(\w+)\s+([\w.]+)$/);
      if (!m) {
        // 非法契约段（F-3 #6-8：`x > 0` / `x number()` / `x` 单独）→ 不再静默 continue
        // return 段由 extractRefineReturnFromSource 处理，这里不报
        if (/^return\b/.test(part)) continue;
        collectDiag({
          code: "nudo:contract-syntax",
          message: `Malformed @nudo:contract segment '${part}' (expected <param> <constraintName> or return <constraintName>; e.g. @nudo:contract x positive)`,
        });
        continue;
      }
      const [, param, cName] = m;
      // return 是后置目标，不进参数契约
      if (param === "return") continue;
      const c = constraints.get(cName!);
      if (!c) {
        // 约束名 miss（别名错绑已修，剩拼写错/侧车缺名）：不再静默 continue，
        // 否则契约无声失效会被误读为「推断不精确」（BUG-016）
        collectDiag({
          code: "nudo:contract-syntax",
          message: `Unknown constraint name '${cName!}' in @nudo:contract (expected a name bound by @nudo:import)`,
        });
        continue;
      }
      out.push({
        param: param!,
        pred: instantiateConstraint(c, param!),
        constraint: c,
        name: cName!,
      });
    }
  }
  return out;
}

/** refine 参数 → 带约束模板的下标表（shape 检查用） */
export function refineToIndexedFull(
  source: string,
  fnName: string,
  paramNames: string[],
  opts: RefineResolveOpts = {},
): Array<[number, RefineEntry]> {
  const raw = extractRefinesFromSource(source, fnName, opts);
  const out: Array<[number, RefineEntry]> = [];
  for (const item of raw) {
    const idx = paramNames.indexOf(item.param);
    if (idx >= 0) out.push([idx, item]);
  }
  return out;
}

/**
 * 解析 `@nudo:contract return positive` → 返回契约。
 * 返回 undefined = 无声明（不猜后置）。
 */
export function extractRefineReturnFromSource(
  source: string,
  fnName: string,
  opts: RefineResolveOpts = {},
): { name: string; constraint: NudoConstraint } | undefined {
  if (!stripStringsKeepComments(source).includes("@nudo:contract")) return undefined;
  const constraints = collectConstraints(source, opts);
  for (const line of extractRefineLines(source, fnName)) {
    const parts = line.split(/&&|,/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^return\s+([\w.]+)$/);
      if (!m) {
        // return 段形态非法（如 `return > 0`）→ 诊断
        if (/^return\b/.test(part) && !/^return\s+[\w.]+$/.test(part)) {
          collectDiag({
            code: "nudo:contract-syntax",
            message: `Malformed @nudo:contract return segment '${part}' (expected return <constraintName>)`,
          });
        }
        continue;
      }
      const cName = m[1]!;
      const c = constraints.get(cName);
      if (!c) {
        // 同参数契约：约束名 miss 不再静默（BUG-016）
        collectDiag({
          code: "nudo:contract-syntax",
          message: `Unknown constraint name '${cName}' in @nudo:contract return (expected a name bound by @nudo:import)`,
        });
        continue;
      }
      return { name: cName, constraint: c };
    }
  }
  return undefined;
}

/**
 * 申报式抛错（declare throws — L2 豁免）：
 *   @nudo:throws Error
 *   @nudo:throws Error, TypeError
 *   @nudo:throws *
 *   @nudo:case "neg" (0) !! throws          → 申报任意 throw
 *   @nudo:case "neg" (0) !! throws Error    → 申报 Error
 *
 * 与 refine 同扫函数前注释块（D6=G2 同一 scope 绑定）。
 * 返回 `*` = 申报任意；数组 = 按名申报；undefined = 无申报（L2 照常执法）。
 */
export function extractDeclaredThrows(
  source: string,
  fnName: string,
): string[] | "*" | undefined {
  const directiveSrc = stripStringsKeepComments(source);
  if (!directiveSrc.includes("@nudo:throws") && !directiveSrc.includes("!! throws")) {
    return undefined;
  }
  const lines = fnDirectiveCommentLines(source, fnName);
  const spec = scanThrowsDecl(lines);
  if (spec === undefined) return undefined;
  if (spec === "*") return "*";
  return spec.split(",").filter(Boolean);
}

/**
 * 函数级预算旋钮（#64 P4）：
 *   @nudo:budget forks=20000
 *   @nudo:budget calls=50000 depth=128
 *   @nudo:budget forks=20000, calls=50000
 *
 * 与 @nudo:throws 同路径扫函数前注释块（D6=G2 同一 scope 绑定）。
 * 只抬高预算（不降低全局默认）；未声明的维度沿用全局。非法值忽略。
 */
export function extractFnBudget(
  source: string,
  fnName: string,
): { forks?: number; calls?: number; depth?: number } | undefined {
  const directiveSrc = stripStringsKeepComments(source);
  if (!directiveSrc.includes("@nudo:budget")) return undefined;
  const lines = fnDirectiveCommentLines(source, fnName);
  return scanBudgetDecl(lines);
}
