/**
 * 精化契约解析：唯一形态
 *
 *   @nudo:refine <param> <constraint>    参数精化（挂入口 Abs，参与运算）
 *   @nudo:refine return <constraint>     返回精化（推断返回值 ⊭ 时红）
 *
 * 不叫 requires：那只是「校验挡板」。
 * refine 表示约束是类型的一部分——Abs = shape × term × **pred** × conf，
 * pred 会流入代数（x>0 ⇒ x+1>1），不只是调用点挡一下。
 *
 * constraint 来自 *.nudo.js 导出的模板（number().gt(0) 等），
 * 由 /// @nudo:import { delay } from "./delay.nudo.js" 引入。
 * 不支持写 `x > 0`（绑死参数名）。
 * 不用 JSDoc @param/@return：那是类型注解语法。
 *
 * `@nudo:interface` 是 `@nudo:refine` 的等价别名（渐进迁移，§design-refine-derivation）。
 * 侧车加载：Babel 语句级改写（多行 import / 注释与字符串里的同形文本不误伤）、
 * 相对 .nudo.js/.nudo.ts 经 loadModule 递归求值、环检测、执行失败改诊断
 * （nudo:interface-load / nudo:interface-cycle，不再静默吞错）。
 */

import type { Pred } from "./pred.ts";
import { v as termVar } from "./term.ts";
import { parseSource } from "./parse-source.ts";
import { hashSource } from "./hash-source.ts";
// leaf 模块：load-deps-fp.ts 已 import 本文件（extractNudoImports），
// 反向 import 会成环——路径函数从 sidecar-path.ts 单源取用
import { isNodeModulesPath, resolveDepPath } from "./sidecar-path.ts";
import type { ImportDeclaration } from "@babel/types";
import {
  type NudoConstraint,
  isNudoConstraint,
  instantiateConstraint,
  number,
  string as stringC,
  boolean as booleanC,
  shape,
  array,
  lit as litC,
  union as unionC,
  fn as fnC,
  and as andC,
  partial as partialC,
  pick as pickC,
  omit as omitC,
} from "./constraint.ts";

/** `/// @nudo:import { delay, percent } from "./delay.nudo.js"` */
export type NamedImport = { names: string[]; spec: string };

export function extractNudoImports(source: string): NamedImport[] {
  const out: NamedImport[] = [];
  // named: import { a, b as c } from "..."
  const named = /@nudo:import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = named.exec(source))) {
    const names = m[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/).pop()!.trim());
    out.push({ names, spec: m[2]! });
  }
  // 兼容 namespace（仍支持）
  const ns = /@nudo:import\s+\*\s+as\s+(\w+)\s+from\s*["']([^"']+)["']/g;
  while ((m = ns.exec(source))) {
    out.push({ names: [`*${m[1]}`], spec: m[2]! });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 侧车加载诊断（side-channel）
//
// 先例 setCallCollector：check 报告之外的结构化旁路。侧车执行失败 / 导出
// 形式不识别原先 `catch { continue }` 静默丢契约，Phase 1 起必须可见。
// ---------------------------------------------------------------------------

/** refine 侧车加载诊断（severity 由消费方按 code 定档，形状对齐 Issue 子集） */
export type RefineDiag = { code: string; message: string; file?: string };

let refineDiagCollector: ((d: RefineDiag) => void) | null = null;
let refineDiagSeq = 0;
const refineDiags: Array<{ seq: number; d: RefineDiag }> = [];
/** 防长会话无界增长；消费方 takeRefineDiags 按批取走 */
const MAX_REFINE_DIAGS = 1024;

/** 设置诊断观察者（null 清除）；缓冲照常累积，takeRefineDiags 取走 */
export function setRefineDiagCollector(fn: ((d: RefineDiag) => void) | null): void {
  refineDiagCollector = fn;
}

/** 当前诊断累计序号（since 锚） */
export function refineDiagCount(): number {
  return refineDiagSeq;
}

/** 取走已收集的诊断（收集即清空） */
export function takeRefineDiags(): RefineDiag[] {
  const out = refineDiags.map((e) => e.d);
  refineDiags.length = 0;
  return out;
}

/** 只取走 seq > since 的增量（工具面防窃取在途诊断；全量 take 的 since 版） */
export function takeRefineDiagsSince(since: number): RefineDiag[] {
  const out: RefineDiag[] = [];
  let kept = 0;
  for (const e of refineDiags) {
    if (e.seq > since) out.push(e.d);
    else refineDiags[kept++] = e;
  }
  refineDiags.length = kept;
  return out;
}

function collectDiag(d: RefineDiag): void {
  if (refineDiags.length >= MAX_REFINE_DIAGS) refineDiags.shift();
  refineDiags.push({ seq: ++refineDiagSeq, d });
  refineDiagCollector?.(d);
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
 * 后续构建器（lit/union/fn/…）落地时只追加此表。
 */
const sidecarInjects: Record<string, unknown> = {
  number,
  string: stringC,
  boolean: booleanC,
  shape,
  array,
  lit: litC,
  union: unionC,
  fn: fnC,
  and: andC,
  partial: partialC,
  pick: pickC,
  omit: omitC,
};

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
): { code: string; exportPairs: Array<{ key: string; expr: string }>; imports: SidecarImport[] } {
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
  return { code, exportPairs, imports };
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
): Record<string, unknown> {
  const fromFile = opts?.fromFile;
  const { code, exportPairs, imports } = rewriteSidecarSource(src, fromFile);
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
          if (!(n.imported in sidecarInjects)) {
            collectDiag({
              code: "nudo:interface-load",
              message: `sidecar import '{ ${n.imported} }' from '${imp.spec}' is not an injected builder`,
              file: fromFile,
            });
          }
          if (n.local !== n.imported || !(n.imported in sidecarInjects)) {
            // 同名注入名由函数参数绑定；alias / 未知名走 __nudoInjects（未知 → undefined）
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
    const depExports = execSidecar(
      depSrc,
      { loadModule: load, fromFile: canonical },
      [...chain, canonical],
      preloaded,
    );
    for (const n of imp.names) {
      if (n.ns) {
        deps[n.local] = depExports;
      } else if (n.imported !== undefined) {
        if (!(n.imported in depExports)) {
          collectDiag({
            code: "nudo:interface-load",
            message: `sidecar '${imp.spec}' has no export '${n.imported}'`,
            file: fromFile,
          });
        }
        deps[n.local] = depExports[n.imported];
      } else {
        // 相对侧车 default import：侧车只收集 named export，default 恒空
        collectDiag({
          code: "nudo:interface-load",
          message: `sidecar default import '${n.local}' from '${imp.spec}' has no default export (sidecars export named constraints only)`,
          file: fromFile,
        });
        deps[n.local] = depExports.default;
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
  return fn(...Object.values(sidecarInjects), sidecarInjects, deps) as Record<string, unknown>;
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

/** *.nudo.js 构建器执行结果（LRU）。键 = 依赖闭包内容指纹；无 loadModule 退化为 src */
const nudoModuleExecCache = new Map<string, Record<string, unknown>>();
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
    const depSrc = loadModule(spec, fromFile);
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
      return hit;
    }
  }

  const out = execSidecar(src, opts, opts.fromFile ? [opts.fromFile] : [], preloaded);
  if (key !== undefined) {
    if (nudoModuleExecCache.size >= MAX_NUDO_MODULE_EXEC) {
      const oldest = nudoModuleExecCache.keys().next().value;
      if (oldest !== undefined) nudoModuleExecCache.delete(oldest);
    }
    nudoModuleExecCache.set(key, out);
  }
  return out;
}

export function resetNudoModuleExecCache(): void {
  nudoModuleExecCache.clear();
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
  const imports = extractNudoImports(source);
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
    const src = opts.loadModule(imp.spec, opts.fromFile);
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
      const v = exports[name];
      if (isNudoConstraint(v)) {
        map.set(name, v);
      } else if (v === undefined) {
        collectDiag({
          code: "nudo:interface-load",
          message: `sidecar '${imp.spec}' has no export '${name}'`,
          file: opts.fromFile,
        });
      } else {
        collectDiag({
          code: "nudo:interface-load",
          message: `sidecar '${imp.spec}' export '${name}' is not a Nudo constraint`,
          file: opts.fromFile,
        });
      }
    }
  }
  return map;
}

/** 从源码抽函数上的 @nudo:refine 行（@nudo:interface 为等价别名） */
function extractRefineLines(source: string, fnName: string): string[] {
  // `export function f` / `export async function f` / `export const f =`
  // 前缀必须一并匹配：否则 match 落在行中，before 以 `export …` 结尾，
  // 反向注释扫描立即 break，@nudo:refine 整体丢失（导出函数的 refine
  // 全部静默失效）。
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fnRe = new RegExp(
    `(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s+${escaped}\\b|const\\s+${escaped}\\s*=)`,
  );
  const m = source.match(fnRe);
  if (!m || m.index === undefined) return [];
  const before = source.slice(0, m.index);
  const lines = before.split("\n");
  const reqs: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line === "" || line === "*/") continue;
    if (line.startsWith("*") || line.startsWith("/*") || line.startsWith("//")) {
      const rm = line.match(/@nudo:(?:refine|interface)\s+(.+)$/);
      if (rm) reqs.unshift(rm[1]!.trim().replace(/\*\/$/, "").trim());
      continue;
    }
    break;
  }
  return reqs;
}

/**
 * 解析 `ms delay` / `n percent` → [param, Pred]
 * 多条用 && 或换行连接。
 * 同时保留原始 NudoConstraint（shape 字段检查用）。
 */
export type RefineEntry = {
  param: string;
  pred: Pred;
  constraint: NudoConstraint;
};

export function extractRefinesFromSource(
  source: string,
  fnName: string,
  opts: RefineResolveOpts = {},
): RefineEntry[] {
  // 快路径：整文件无 @nudo:refine/@nudo:interface 时免 regex 扫全文（after-edit 批量 check）
  if (!source.includes("@nudo:refine") && !source.includes("@nudo:interface")) return [];
  const constraints = collectConstraints(source, opts);
  const out: RefineEntry[] = [];
  for (const line of extractRefineLines(source, fnName)) {
    const parts = line.split(/&&|,/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      // 约束名支持 `ns.foo` 命名空间展开（@nudo:import * as ns）
      const m = part.match(/^(\w+)\s+([\w.]+)$/);
      if (!m) continue;
      const [, param, cName] = m;
      // return 是后置目标，不进参数精化
      if (param === "return") continue;
      const c = constraints.get(cName!);
      if (!c) continue;
      out.push({
        param: param!,
        pred: instantiateConstraint(c, param!),
        constraint: c,
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
 * 解析 `@nudo:refine return positive` → 返回精化。
 * 返回 undefined = 无声明（不猜后置）。
 */
export function extractRefineReturnFromSource(
  source: string,
  fnName: string,
  opts: RefineResolveOpts = {},
): { name: string; constraint: NudoConstraint } | undefined {
  if (!source.includes("@nudo:refine") && !source.includes("@nudo:interface")) return undefined;
  const constraints = collectConstraints(source, opts);
  for (const line of extractRefineLines(source, fnName)) {
    const parts = line.split(/&&|,/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^return\s+([\w.]+)$/);
      if (!m) continue;
      const cName = m[1]!;
      const c = constraints.get(cName);
      if (!c) continue;
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
 * 与 refine 同扫函数前注释块。返回 `*` = 申报任意；数组 = 按名申报；
 * undefined = 无申报（L2 照常执法）。
 */
export function extractDeclaredThrows(
  source: string,
  fnName: string,
): string[] | "*" | undefined {
  if (!source.includes("@nudo:throws") && !source.includes("!! throws")) {
    return undefined;
  }
  const kinds = new Set<string>();
  let any = false;
  // 与 extractRefineLines 同路径扫函数前注释块（throws/case 不在 refine 行文法里）
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fnRe = new RegExp(
    `(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?(?:function\\s+${escaped}\\b|const\\s+${escaped}\\s*=)`,
  );
  const m = source.match(fnRe);
  if (!m || m.index === undefined) return undefined;
  const before = source.slice(0, m.index);
  const lines = before.split("\n");
  let seenComment = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    // 先吃 export 前的尾部空行；一旦进入注释块，再遇空行 = 块边界
    if (line === "") {
      if (seenComment) break;
      continue;
    }
    if (line === "*/") continue;
    if (line.startsWith("*") || line.startsWith("/*") || line.startsWith("//")) {
      seenComment = true;
      const body = line.replace(/^[*/\s]+/, "").replace(/\*\/$/, "").trim();
      const th = body.match(/@nudo:throws\s+(.+)$/i);
      if (th) {
        const spec = th[1]!.trim();
        if (spec === "*") any = true;
        else {
          for (const k of spec.split(/[,\s|]+/).map((s) => s.trim()).filter(Boolean)) {
            if (k === "*") any = true;
            else kinds.add(k);
          }
        }
      }
      const cs = body.match(/!!\s*throws(?:\s+([A-Za-z*][\w*|,\s]*))?/i);
      if (cs) {
        const spec = (cs[1] ?? "*").trim();
        if (spec === "" || spec === "*") any = true;
        else {
          for (const k of spec.split(/[,\s|]+/).map((s) => s.trim()).filter(Boolean)) {
            if (k === "*") any = true;
            else kinds.add(k);
          }
        }
      }
      continue;
    }
    break;
  }
  if (any) return "*";
  if (kinds.size > 0) return [...kinds];
  return undefined;
}
