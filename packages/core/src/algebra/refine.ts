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
import { createScopedSlot, registerCollectorScopeParticipant } from "./collector-scope.ts";
// D5=F1：指令抽取单源在 directive-scan.ts（G2 作用域 + 文法），本文件只消费
import {
  cleanDirectiveLine,
  extractNudoImportRecords,
  findFnDirectiveScope,
  fnDirectiveCommentLines,
  scanAssumeSegments,
  scanInvariantSegments,
  scanBudgetDecl,
  scanContractSegments,
  scanMalformedNudoImports,
  scanThrowsDecl,
  type FnDirectiveScope,
  type NudoImportRecord,
} from "./directive-scan.ts";
import type { File, ImportDeclaration } from "@babel/types";
import {
  type NudoConstraint,
  isNudoConstraint,
  instantiateConstraint,
  andC,
  CONSTRAINT_BUILDERS,
} from "./constraint.ts";
// JS 绑定名文法（Unicode 合法，如 `小数` / `$x`）——Bug 350：三条源码指令
// 的标识符文法只收 ASCII ⇒ 中文标识符被判 malformed（L1 假红），而侧车面
// 把同一个中文名当一等公民 ⇒ 跨面自相矛盾。codegen-escape 是 leaf，无环。
import { isJsBindingIdent } from "./codegen-escape.ts";
import { DIAG } from "./diag-codes.ts";

/** `/// @nudo:import { delay, percent } from "./delay.nudo.js"` */
export type NamedImport = { names: string[]; spec: string };

/** default / 未识别 `@nudo:import` 形态 → nudo:contract-syntax（不再静默丢弃） */
function diagnoseMalformedNudoImports(source: string): void {
  for (const bad of scanMalformedNudoImports(source)) {
    if (bad === "malformed-default") {
      collectDiag({
        code: DIAG.contractSyntax,
        message: `Default @nudo:import is not supported (use named { a, b } or namespace * as ns)`,
      });
    } else {
      collectDiag({
        code: DIAG.contractSyntax,
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

/**
 * 侧车撞名诊断的**作用域内去重**集（同一侧车的同一撞名只报一次）。
 * 撞名诊断随 exec 结果缓存、每次调用重发 ⇒ 不去重会在一个作用域里
 * 重复 N 次（每个函数一次 effectiveInterface）。
 *
 * 每个分析作用域一份**新**集合：ScopedSlot 的继承语义是「同一个对象」，
 * 直接用会把上一轮分析已报的撞名带进下一轮 ⇒ 门禁面看不到（分析器先跑、
 * checkSource 后跑，两轮都在同一进程）。
 */
const sidecarClashReported = createScopedSlot<Set<string>>(() => new Set<string>());
registerCollectorScopeParticipant((body) => {
  const prev = sidecarClashReported.get();
  sidecarClashReported.set(new Set<string>());
  try {
    return sidecarClashReported.runScoped(body);
  } finally {
    sidecarClashReported.set(prev);
  }
});

/**
 * 发出侧车撞名诊断（Bug 356 扩展面 ②）。
 * 撞名 = 侧车自己的顶层声明与它 import 的本地名同名 ⇒ native ESM 是
 * SyntaxError（重复声明，模块不装载）；引擎里是「遮蔽」⇒ 导入值静默丢失、
 * 契约悄悄变弱 ⇒ 必须显式报出（建议改名）。
 *
 * 诊断码取 nudo:interface-load：这是**侧车装载**问题（侧车按写法装载不出
 * 期望的契约），且只有这一族码会被消费方（service 分析器）取走并进门禁
 * 报告——nudo:interface-name-clash 会被白名单过滤掉、诊断不可见。
 */
function emitSidecarClashDiags(
  clashes: readonly SidecarClash[],
  fromFile: string | undefined,
): void {
  if (clashes.length === 0) return;
  const reported = sidecarClashReported.get();
  for (const c of clashes) {
    const sig = `${fromFile ?? ""}\u0000${c.local}\u0000${c.spec}`;
    if (reported.has(sig)) continue;
    reported.add(sig);
    collectDiag({
      code: DIAG.interfaceLoad,
      message: `sidecar declares '${c.local}' at top level and also imports it from '${c.spec}' — native ESM rejects a duplicate declaration (SyntaxError); rename one of them`,
      file: fromFile,
    });
  }
}

// ---------------------------------------------------------------------------
// 侧车加载诊断（side-channel）
//
// 先例 setCallCollector：check 报告之外的结构化旁路。侧车执行失败 / 导出
// 形式不识别原先 `catch { continue }` 静默丢契约，Phase 1 起必须可见。
// ---------------------------------------------------------------------------

/** refine 侧车加载诊断（severity 由消费方按 code 定档，形状对齐 Issue 子集） */
export type RefineDiag = {
  code: string;
  message: string;
  file?: string;
  /** Bug 374：诊断位置（1-based 行 / 0-based 列；与 Babel loc 同坐标面） */
  line?: number;
  column?: number;
};

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

/**
 * 侧车顶层声明 ∩ 侧车自身 import 绑定 的撞名（Bug 356 扩展面 ②）。
 * native ESM：重复声明 ⇒ SyntaxError（模块根本不装载）；引擎里是「遮蔽」⇒
 * 导入值静默丢失、契约悄悄变弱 ⇒ 必须显式报出。
 */
type SidecarClash = { local: string; spec: string };

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
  /**
   * 侧车**自身顶层**声明的名字（const/let/var/function/class）。
   * 用于冲突检测：与 import 绑定同名 ⇒ native ESM 是 SyntaxError
   * （Bug 356 扩展面 ②：相对 import 的本地名被侧车自己的顶层声明遮蔽 ⇒
   * 导入值静默丢失）。这里只收顶层、只收标识符（解构模式不收）。
   */
  declaredNames: Set<string>;
} {
  // .nudo.ts 需要未剥除 TS 的 AST（keepTs）——类型注解/声明的区间才能切除；
  // 默认路径照旧走剥除（全链消费方依赖剥除后形态）
  const keepTs = fromFile?.endsWith(".nudo.ts") === true;
  const ast = parseSource(src, keepTs ? { keepTs: true } : undefined);
  const cuts: Array<{ start: number; end: number; text: string }> = [];
  /** 导出表：key = 绑定名（含 "default"），expr = 求值表达式标识符 */
  const exportPairs: Array<{ key: string; expr: string }> = [];
  const imports: SidecarImport[] = [];
  /** 侧车自身顶层的声明名（冲突检测用；见返回型的 declaredNames） */
  const declaredNames = new Set<string>();
  const DEFAULT_LOCAL = "__nudoDefault";

  /** 顶层声明名收集：const/let/var 的标识符声明 + function/class 名 */
  const noteDeclared = (decl: unknown): void => {
    if (typeof decl !== "object" || decl === null) return;
    const d = decl as {
      type?: string;
      id?: { type?: string; name?: string } | null;
      declarations?: Array<{ id?: { type?: string; name?: string } | null }>;
    };
    if (d.type === "VariableDeclaration") {
      for (const dec of d.declarations ?? []) {
        if (dec.id?.type === "Identifier" && typeof dec.id.name === "string") {
          declaredNames.add(dec.id.name);
        }
      }
      return;
    }
    if (d.id?.type === "Identifier" && typeof d.id.name === "string") {
      declaredNames.add(d.id.name);
    }
  };

  const badExport = (what: string): void => {
    collectDiag({
      code: DIAG.interfaceLoad,
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
      if (decl) noteDeclared(decl);
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
          declaredNames.add(decl.id.name);
        } else {
          // 匿名：包一层本地绑定
          exportPairs.push({ key: "default", expr: DEFAULT_LOCAL });
          declaredNames.add(DEFAULT_LOCAL);
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
        declaredNames.add(DEFAULT_LOCAL);
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
      continue;
    }
    // 顶层声明（const/let/var/function/class）：不在 export 形态里
    noteDeclared(stmt);
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
  return { code, exportPairs, imports, bindingInfos, declaredNames };
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
  /** 侧车顶层声明 ∩ import 绑定的撞名（Bug 356 扩展面 ②）；随结果缓存，命中时重发 */
  clashes: SidecarClash[];
} {
  const fromFile = opts?.fromFile;
  const { code, exportPairs, imports, bindingInfos, declaredNames } = rewriteSidecarSource(
    src,
    fromFile,
  );
  const prologue: string[] = [];
  const deps: Record<string, unknown> = {};
  /** import 绑定名 → 来源 spec（冲突检测用；见 declaredNames 冲突诊断） */
  const importBound = new Map<string, string>();
  /** 依赖侧车的撞名（合并进本侧车的 clashes，随 exec 结果一起缓存） */
  const depClashes: SidecarClash[] = [];

  for (const imp of imports) {
    const relative = imp.spec.startsWith(".") || imp.spec.startsWith("/");
    if (!relative) {
      // 裸包名 / @nudojs/core：注入
      for (const n of imp.names) {
        if (n.ns) {
          // namespace import 绑成整个 inject 表会静默把 fs/path 等本地名
          // 变成构建器袋——显式诊断，不再静默错绑
          collectDiag({
            code: DIAG.interfaceLoad,
            message: `sidecar namespace import '${n.local}' from '${imp.spec}' is not supported (import named builders only)`,
            file: fromFile,
          });
          prologue.push(`var ${n.local} = __nudoInjects;`);
          importBound.set(n.local, imp.spec);
        } else if (n.imported !== undefined) {
          // 自有属性判定：`in` 会命中 Object.prototype（toString 等）——
          // 诊断被吞 + __nudoInjects 裸读把原生函数绑进侧车执行域
          const hasOwnInject = Object.hasOwn(sidecarInjects, n.imported);
          if (!hasOwnInject) {
            collectDiag({
              code: DIAG.interfaceLoad,
              message: `sidecar import '{ ${n.imported} }' from '${imp.spec}' is not an injected builder`,
              file: fromFile,
            });
            prologue.push(`var ${n.local} = undefined;`);
          } else if (n.local !== n.imported) {
            // 同名注入名由外层解构绑定；alias 走 __nudoInjects（hasOwn 已证自有键）
            prologue.push(`var ${n.local} = __nudoInjects[${JSON.stringify(n.imported)}];`);
            importBound.set(n.local, imp.spec);
          }
        } else {
          // default import：侧车无默认导出概念——显式诊断（不再静默 undefined）
          collectDiag({
            code: DIAG.interfaceLoad,
            message: `sidecar default import '${n.local}' from '${imp.spec}' has no default export to bind (sidecars export named constraints only)`,
            file: fromFile,
          });
          prologue.push(`var ${n.local} = undefined;`);
          importBound.set(n.local, imp.spec);
        }
      }
      continue;
    }
    const load = opts?.loadModule;
    if (!load || !fromFile) {
      collectDiag({
        code: DIAG.interfaceLoad,
        message: `sidecar import '${imp.spec}' is unresolvable (no loadModule for relative specifier)`,
        file: fromFile,
      });
      for (const n of imp.names) deps[n.local] = undefined;
      continue;
    }
    if (!isSidecarSpec(imp.spec)) {
      collectDiag({
        code: DIAG.interfaceLoad,
        message: `sidecar import '${imp.spec}' unsupported: relative imports must target .nudo.js/.nudo.ts`,
        file: fromFile,
      });
      for (const n of imp.names) deps[n.local] = undefined;
      continue;
    }
    const canonical = resolveDepPath(fromFile, imp.spec);
    if (isNodeModulesPath(canonical)) {
      collectDiag({
        code: DIAG.interfaceLoad,
        message: `sidecar import '${imp.spec}' resolves into node_modules (${canonical}); ambient sidecar loading never crosses node_modules`,
        file: fromFile,
      });
      for (const n of imp.names) deps[n.local] = undefined;
      continue;
    }
    if (chain.includes(canonical)) {
      throw new NudoSidecarError(
        DIAG.interfaceCycle,
        `sidecar import cycle: ${[...chain, canonical].join(" → ")}`,
      );
    }
    const depSrc = preloaded.has(canonical) ? preloaded.get(canonical) : load(imp.spec, fromFile);
    if (depSrc === undefined) {
      collectDiag({
        code: DIAG.interfaceLoad,
        message: `sidecar import '${imp.spec}' is unresolvable (loadModule returned no source)`,
        file: fromFile,
      });
      for (const n of imp.names) deps[n.local] = undefined;
      continue;
    }
    // Bug 345：依赖侧车的求值异常**原样冒泡** ⇒ 上层诊断指向**导入方**
    // （"sidecar './m.nudo.js' failed to load: Identifier 'pick' has already
    // been declared"）且点名导入方根本没有的名字——用户去 m.nudo.js 里找
    // 'pick' 永远找不到。包装成 Nudo 原生诊断并**点名依赖侧车路径**。
    // 环诊断自带链（NudoSidecarError）⇒ 原样上抛，不重包。
    let depOut: {
      exports: Record<string, unknown>;
      bindingInfos: Map<string, SidecarBindingInfo>;
      clashes: SidecarClash[];
    };
    try {
      depOut = execSidecar(
        depSrc,
        { loadModule: load, fromFile: canonical },
        [...chain, canonical],
        preloaded,
      );
    } catch (e) {
      if (e instanceof NudoSidecarError) throw e;
      const reason = e instanceof Error ? e.message : String(e);
      throw new NudoSidecarError(
        DIAG.interfaceLoad,
        `sidecar '${imp.spec}' (imported by '${fromFile ?? "(unknown)"}') failed to load: ${reason}`,
      );
    }
    depClashes.push(...depOut.clashes);
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
            code: DIAG.interfaceLoad,
            message: `sidecar '${imp.spec}' has no export '${n.imported}'`,
            file: fromFile,
          });
          deps[n.local] = undefined;
        }
      } else {
        // 相对侧车 default import：侧车只收集 named export，default 恒空
        collectDiag({
          code: DIAG.interfaceLoad,
          message: `sidecar default import '${n.local}' from '${imp.spec}' has no default export (sidecars export named constraints only)`,
          file: fromFile,
        });
        deps[n.local] = Object.hasOwn(depExports, "default") ? depExports.default : undefined;
      }
      importBound.set(n.local, imp.spec);
    }
  }

  // Bug 356 扩展面 ②：侧车自己的顶层声明与 import 绑定同名 ⇒ native ESM 是
  // SyntaxError（重复声明）；引擎里则是「遮蔽」⇒ 导入值静默丢失（契约悄悄
  // 变弱）。**显式报出**可操作的诊断（建议改名），不静默。
  //
  // 诊断码取 nudo:interface-load：这是**侧车装载**问题（侧车按写法装载不出
  // 期望的契约），且只有这一族码会被消费方（service 分析器）取走并进门禁
  // 报告——nudo:interface-name-clash 会被白名单过滤掉、诊断不可见。
  //
  // 诊断**不在此处**发出：exec 结果进缓存后，缓存命中不再跑 exec ⇒ 此处
  // 发出的诊断会在后续分析里消失（门禁面看不到）。改为把冲突**随 exec 结果
  // 一起缓存**，由 execNudoModuleCached 在每次调用（含缓存命中）时统一发出。
  const clashes: SidecarClash[] = [];
  for (const [local, spec] of importBound) {
    if (!declaredNames.has(local)) continue;
    clashes.push({ local, spec });
  }
  clashes.push(...depClashes);

  for (const local of Object.keys(deps)) {
    prologue.push(`var ${local} = __nudoDeps[${JSON.stringify(local)}];`);
  }

  const returnObj = exportPairs
    .map((p) =>
      p.key === p.expr ? p.key : `${JSON.stringify(p.key)}: ${p.expr}`,
    )
    .join(", ");
  // Bug 338 / 356：注入名不得占用**侧车自身的顶层作用域**。
  // 旧口径把 15 个构建器名当 `new Function` 的**形参**——侧车里的
  // `const pick = …`（rewriteSidecarSource 把 `export const` 改成 `const`）
  // 与形参同名 ⇒ SyntaxError「Cannot declare a const variable twice」
  // ⇒ 侧车根本加载不了 ⇒ 该文件全部契约丢失、三个运行时产物面退化为
  // 「接受一切」，而 `nudo export` 仍 exit 0 零告警。
  // 改成两层作用域：外层 = 注入袋 + 构建器解构 + 依赖绑定；内层 IIFE =
  // 侧车自己的代码。侧车的词法声明与外层注入名**同名**时是「遮蔽」（不同
  // 作用域）而不是「重复声明」——与 native ESM 一致（未导入的名字本就不在
  // 作用域里，遮蔽是合法的）。
  const builderNames = Object.keys(sidecarInjects);
  const body = [
    `const { ${builderNames.join(", ")} } = __nudoInjects;`,
    prologue.length > 0 ? prologue.join("\n") : "",
    "return (function () {",
    code,
    `return { ${returnObj} };`,
    "})();",
  ]
    .filter((part) => part !== "")
    .join("\n");
  const fn = new Function("__nudoInjects", "__nudoDeps", body);
  const result = fn(sidecarInjects, deps) as Record<string, unknown>;
  // 绑定信息登记：成功求值后按侧车 canonical 路径 + 内容
  // hash 入库（失败不登记；resetNudoModuleExecCache 同口径清除）。
  // exec 缓存命中不重登记——同内容首次求值已入库；命中路径
  // 的跨路径补登记在 execNudoModuleCached（同内容不同路径）。
  if (fromFile !== undefined && bindingInfos.size > 0) {
    registerSidecarParamTexts(fromFile, hashSource(src), bindingInfos);
  }
  return { exports: result, bindingInfos, clashes };
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
 * 由 execNudoModuleCached 按当前路径补登记参数折叠文本；
 * clashes = 侧车顶层声明 ∩ import 绑定的撞名（Bug 356 扩展面 ②）——
 * 缓存命中不再跑 exec ⇒ 撞名诊断必须**随结果一起缓存**并在命中时重发，
 * 否则门禁面看不到（分析器先跑、checkSource 后跑 ⇒ 只有后跑那次能报）。 */
const nudoModuleExecCache = new Map<
  string,
  {
    exports: Record<string, unknown>;
    bindingInfos: Map<string, SidecarBindingInfo>;
    clashes: SidecarClash[];
  }
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
      // 撞名诊断随结果缓存 ⇒ 命中时**重发**（否则门禁面看不到：
      // 分析器先跑、checkSource 后跑，只有后跑那次能报）
      emitSidecarClashDiags(hit.clashes, opts.fromFile);
      return hit.exports;
    }
    if (nudoModuleFailCache.has(key)) {
      throw nudoModuleFailCache.get(key);
    }
  }

  try {
    const { exports, bindingInfos, clashes } = execSidecar(src, opts, opts.fromFile ? [opts.fromFile] : [], preloaded);
    emitSidecarClashDiags(clashes, opts.fromFile);
    if (key !== undefined) {
      if (nudoModuleExecCache.size >= MAX_NUDO_MODULE_EXEC) {
        const oldest = nudoModuleExecCache.keys().next().value;
        if (oldest !== undefined) nudoModuleExecCache.delete(oldest);
      }
      nudoModuleExecCache.set(key, { exports, bindingInfos, clashes });
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
 * Bug 344：两条 `@nudo:import` 绑**同一个本地名** ⇒ `map.set` 后写覆盖先写，
 * 零冲突检测零诊断 ⇒ 契约裁决随**行序**翻转（native ESM 是 SyntaxError：
 * 模块根本不装载）。
 *
 * 口径：**拒绝绑定**该本地名（不猜哪条赢——猜错就是静默的假绿/假红）+ 报
 * error 级诊断（nudo:interface-name-clash）。返回冲突的本地名集合。
 */
function duplicateImportBindings(
  imports: NudoImportRecord[],
  file: string | undefined,
): Set<string> {
  const owner = new Map<string, string>();
  const dup = new Set<string>();
  for (const imp of imports) {
    for (const raw of imp.names) {
      // namespace 记 `*ns` ⇒ 本地名是 `ns` 本身
      const local = raw.startsWith("*") ? raw.slice(1) : raw;
      const prev = owner.get(local);
      if (prev === undefined) {
        owner.set(local, imp.spec);
        continue;
      }
      dup.add(local);
      collectDiag({
        code: DIAG.interfaceNameClash,
        message: `duplicate @nudo:import binding '${local}' (from '${prev}' and '${imp.spec}') — native ESM rejects a duplicate declaration (SyntaxError); rename one of them`,
        file,
      });
    }
  }
  return dup;
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
  const dupBindings = duplicateImportBindings(imports, opts.fromFile);
  for (const imp of imports) {
    if (!opts.loadModule || !opts.fromFile) {
      // host 忘传 loader：约束会静默失效——必须报，否则 refine 无声消失
      collectDiag({
        code: DIAG.interfaceLoad,
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
        code: DIAG.interfaceLoad,
        message: `sidecar '${imp.spec}' failed to load from '${opts.fromFile}': ${e instanceof Error ? e.message : String(e)}`,
        file: opts.fromFile,
      });
      continue;
    }
    if (src === undefined) {
      collectDiag({
        code: DIAG.interfaceLoad,
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
          code: DIAG.interfaceLoad,
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
        // 同名 import 绑定冲突（Bug 344）⇒ 拒绝绑定，不展开
        if (dupBindings.has(ns)) continue;
        for (const [expName, v] of Object.entries(exports)) {
          if (isNudoConstraint(v)) {
            map.set(`${ns}.${expName}`, v);
          }
        }
        continue;
      }
      // 同名 import 绑定冲突（Bug 344）⇒ 拒绝绑定（不猜哪条赢）
      if (dupBindings.has(name)) continue;
      // `a as b`：查导出表用原始导出名 a，绑定用本地名 b（import 绑定语义
      // local ← imported；BUG-016 修复前用 b 查表 → 契约静默失效）
      const imported = imp.importedOfLocal[name] ?? name;
      // 自有属性读：toString 等键裸读踩原型链，把原型成员当侧车导出
      const v = Object.hasOwn(exports, imported) ? exports[imported] : undefined;
      if (isNudoConstraint(v)) {
        map.set(name, v);
      } else if (v === undefined) {
        collectDiag({
          code: DIAG.interfaceLoad,
          message: `sidecar '${imp.spec}' has no export '${imported}'`,
          file: opts.fromFile,
        });
      } else {
        collectDiag({
          code: DIAG.interfaceLoad,
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

// ---------------------------------------------------------------------------
// Bug 374：指令位置（诊断定位到**出错指令行**，不是函数声明行 / 文件首行）
//
// 口径：行 1-based、列 0-based（与 Babel loc 同坐标面）。
// 作用域 = 该函数自己的前导注释块（findFnDirectiveScope）⇒ 别的函数里的
// 同形指令不会把位置带偏；注释文本的第 k 行 ↔ 源文件第
// `commentStartLines[i] + k` 行（块注释首行 = `/**` 所在行；行注释首行 =
// `//` 所在行）⇒ 位置与源码逐行对齐。
// ---------------------------------------------------------------------------

/** 指令位置（1-based 行 / 0-based 列） */
export type DirectiveLoc = { line: number; column?: number };

/** 函数的前导指令 scope（源码解析失败 → undefined） */
function fnDirectiveScopeOf(source: string, fnName: string): FnDirectiveScope | undefined {
  let file: File;
  try {
    file = parseSource(source);
  } catch {
    return undefined;
  }
  return findFnDirectiveScope(file, fnName);
}

/**
 * 指令段 → 源位置。找不到（段与注释行对不上 / 无 scope）→ undefined。
 * 列 = 该指令文本在源码行里的起始偏移（0-based）；对不上则省略。
 */
function directiveSegLoc(
  source: string,
  scope: FnDirectiveScope | undefined,
  prefix: string,
  seg: string,
): DirectiveLoc | undefined {
  if (!scope) return undefined;
  const srcLines = source.split("\n");
  for (let ci = 0; ci < scope.commentTexts.length; ci++) {
    const start = scope.commentStartLines[ci] ?? 0;
    if (!start) continue;
    const rawLine = srcLines[start - 1] ?? "";
    const kind: "line" | "block" = rawLine.trimStart().startsWith("//") ? "line" : "block";
    const lines = scope.commentTexts[ci]!.split("\n");
    for (let li = 0; li < lines.length; li++) {
      const cleaned = cleanDirectiveLine(lines[li]!, kind);
      if (!cleaned.startsWith(prefix)) continue;
      const body = cleaned.slice(prefix.length).trim().replace(/\*\/$/, "").trim();
      if (body !== seg) continue;
      const line = start + li;
      const col = (srcLines[line - 1] ?? "").indexOf(cleaned);
      return { line, ...(col >= 0 ? { column: col } : {}) };
    }
  }
  return undefined;
}

/**
 * 该函数的 @nudo:contract 段 → 源位置（Bug 374：接口冲突定位到出错指令行）。
 * 消费方按段首 token（参数名 / `return`）挑出对应的那一条。
 */
export function contractSegmentLocs(
  source: string,
  fnName: string,
): Array<{ segment: string; loc?: DirectiveLoc }> {
  const scope = fnDirectiveScopeOf(source, fnName);
  if (!scope) return [];
  return scanContractSegments(scope.commentLines).map((segment) => ({
    segment,
    loc: directiveSegLoc(source, scope, "@nudo:contract", segment),
  }));
}

/**
 * @nudo:assume 解析段（issue #152 用户引理前提）。
 * ok：lhs ≤ rhs（`>=` 段已在解析时翻转，消费方只见 le）；
 * bad：文法外原文（`<` / `>` / `==`、字面量界等——check 发 nudo:assume-invalid）。
 * 锚定 = AST 最近 Function（与 @nudo:contract 同 D6=G2 注释块绑定）。
 */
export type AssumeSeg =
  | { kind: "ok"; lhs: string; rhs: string; line?: number; column?: number }
  | { kind: "bad"; raw: string; line?: number; column?: number };

/**
 * 关系文法 `<name> <= <name>` / `<name> >= <name>`——名字是 **JS 绑定名**
 * （Unicode 合法，如 `小数`；`$x` 也合法）。
 *
 * Bug 350：旧口径用 ASCII 正则 `[A-Za-z_$][\w$]*` ⇒ 中文标识符被判
 * malformed（check 发 nudo:assume-invalid ⇒ **L1 假红**），而侧车面把同一个
 * 中文名当一等公民 ⇒ 跨面自相矛盾。三条源码指令统一走 JS 标识符文法。
 */
function parseRelationalSeg(
  seg: string,
): { lhs: string; rhs: string } | undefined {
  const m = seg.match(/^(.*?)\s*(<=|>=)\s*(.*)$/);
  if (!m) return undefined;
  const lhs = m[1]!.trim();
  const rhs = m[3]!.trim();
  if (!isJsBindingIdent(lhs) || !isJsBindingIdent(rhs)) return undefined;
  // `>=` 翻转为 le（消费方只见 le）：lhs/rhs 互换
  return m[2] === ">=" ? { lhs: rhs, rhs: lhs } : { lhs, rhs };
}

export function extractAssumeSegs(source: string, fnName: string): AssumeSeg[] {
  // 快路径：整文件无 @nudo:assume 时免 parse 全文（与 extractRefinesFromSource 同口径）
  // 指令住注释——字符串里的同形文本不算
  if (!stripStringsKeepComments(source).includes("@nudo:assume")) return [];
  const scope = fnDirectiveScopeOf(source, fnName);
  const out: AssumeSeg[] = [];
  for (const seg of scanAssumeSegments(scope?.commentLines ?? [])) {
    // 仅 var ≤ var（var-var 关系引理；`>=` 翻转为 le）；常数界属侧车契约文法
    const rel = parseRelationalSeg(seg);
    // Bug 374：段位置 = 出错指令所在行（诊断不再落在文件首行）
    const loc = directiveSegLoc(source, scope, "@nudo:assume", seg);
    if (rel) {
      out.push({
        kind: "ok",
        lhs: rel.lhs,
        rhs: rel.rhs,
        ...(loc ? { line: loc.line, ...(loc.column !== undefined ? { column: loc.column } : {}) } : {}),
      });
      continue;
    }
    out.push({
      kind: "bad",
      raw: seg,
      ...(loc ? { line: loc.line, ...(loc.column !== undefined ? { column: loc.column } : {}) } : {}),
    });
  }
  return out;
}

/**
 * @nudo:invariant 解析段（issue #176 循环携带界，assume 的循环类比物）。
 * ok：`<name><path> <rel> <number>`——path = `[*]`（元素域）/ `.ident`
 * （obj 槽）序列（可空 = 标量），rel ∈ >= <= > <，数字允许负号（小数可）；
 * display 为规范形原文（供 nudo:invariant-relied 审计标注）。
 * bad：文法外原文（消费方 check 发 nudo:invariant-invalid）。
 * 锚定 = AST 最近 Function（与 @nudo:assume 同 D6=G2 注释块绑定）。
 */
export type InvariantSeg =
  | {
      kind: "ok";
      name: string;
      path: Array<{ k: "idx" } | { k: "prop"; name: string }>;
      rel: "ge" | "le" | "gt" | "lt";
      value: number;
      display: string;
      line?: number;
      column?: number;
    }
  | { kind: "bad"; raw: string; line?: number; column?: number };

/**
 * 不变量的路径文法：`[*]`（元素域）/ `.ident`（obj 槽）序列（可空 = 标量）。
 * `ident` 是 **JS 绑定名**（Unicode 合法，如 `.小数`）——Bug 350。
 */
function parseInvariantPath(
  s: string,
): Array<{ k: "idx" } | { k: "prop"; name: string }> | undefined {
  const out: Array<{ k: "idx" } | { k: "prop"; name: string }> = [];
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("[*]", i)) {
      out.push({ k: "idx" });
      i += 3;
      continue;
    }
    if (s[i] !== ".") return undefined;
    let j = i + 1;
    while (j < s.length && s[j] !== "." && s[j] !== "[") j += 1;
    const name = s.slice(i + 1, j);
    if (!isJsBindingIdent(name)) return undefined;
    out.push({ k: "prop", name });
    i = j;
  }
  return out;
}

/**
 * 不变量段文法：`<name><path> <rel> <number>`。
 * `name` 是 **JS 绑定名**（Unicode 合法）；`path` 见 parseInvariantPath。
 * Bug 350：旧口径是纯 ASCII 正则 ⇒ 中文标识符被判 malformed（L1 假红）。
 */
function parseInvariantSeg(seg: string): {
  name: string;
  path: Array<{ k: "idx" } | { k: "prop"; name: string }>;
  rel: "ge" | "le" | "gt" | "lt";
  value: number;
  display: string;
} | undefined {
  const m = seg.match(/^(.*?)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const head = m[1]!.trim();
  const relTxt = m[2]!;
  const numTxt = m[3]!;
  // `<name><path>`：名字是最长合法绑定名前缀，路径从第一个 `.` / `[` 起
  const cut = head.search(/[.[]/);
  const name = cut < 0 ? head : head.slice(0, cut);
  const pathStr = cut < 0 ? "" : head.slice(cut);
  if (!isJsBindingIdent(name)) return undefined;
  const path = parseInvariantPath(pathStr);
  if (path === undefined) return undefined;
  return {
    name,
    path,
    rel: relTxt === ">=" ? "ge" : relTxt === "<=" ? "le" : relTxt === ">" ? "gt" : "lt",
    value: Number(numTxt),
    display: `${name}${pathStr} ${relTxt} ${numTxt}`,
  };
}

export function extractInvariantSegs(source: string, fnName: string): InvariantSeg[] {
  // 快路径：整文件无 @nudo:invariant 时免 regex 扫全文（与 extractAssumeSegs 同口径）
  // 指令住注释——字符串里的同形文本不算
  if (!stripStringsKeepComments(source).includes("@nudo:invariant")) return [];
  const out: InvariantSeg[] = [];
  const scope = fnDirectiveScopeOf(source, fnName);
  for (const seg of scanInvariantSegments(scope?.commentLines ?? [])) {
    // Bug 374：段位置 = 出错指令所在行（诊断不再落在文件首行）
    const loc = directiveSegLoc(source, scope, "@nudo:invariant", seg);
    const pos = loc
      ? { line: loc.line, ...(loc.column !== undefined ? { column: loc.column } : {}) }
      : {};
    const parsed = parseInvariantSeg(seg);
    if (!parsed) {
      out.push({ kind: "bad", raw: seg, ...pos });
      continue;
    }
    out.push({ kind: "ok", ...parsed, ...pos });
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

/**
 * 契约段的两个名字是否合法：形参位是 **JS 绑定名**（Unicode 合法，如 `计数`
 * / `$x`）；约束名是绑定名，可带命名空间前缀（`ns.foo`，@nudo:import * as ns）。
 *
 * Bug 350：旧口径 `^(\w+)\s+([\w.]+)$` 只收 ASCII ⇒ 中文标识符 / `$` 前缀等
 * 合法 JS 绑定名被判 malformed（check 发 nudo:contract-syntax ⇒ **L1 假红**），
 * 而侧车面把同一个中文名当一等公民 ⇒ 跨面自相矛盾。
 */
function isContractSegmentNames(param: string, cName: string): boolean {
  if (param !== "return" && !isJsBindingIdent(param)) return false;
  return cName.split(".").every((p) => isJsBindingIdent(p));
}

export function extractRefinesFromSource(
  source: string,
  fnName: string,
  opts: RefineResolveOpts = {},
): RefineEntry[] {
  // 快路径：整文件无 @nudo:contract 时免 regex 扫全文（after-edit 批量 check）
  // 指令住注释——字符串里的同形文本不算
  if (!stripStringsKeepComments(source).includes("@nudo:contract")) return [];
  const constraints = collectConstraints(source, opts);
  const scope = fnDirectiveScopeOf(source, fnName);
  const out: RefineEntry[] = [];
  for (const line of extractRefineLines(source, fnName)) {
    // Bug 374：诊断位置 = 出错指令行（contract-syntax 不再落在文件首行）
    const loc = directiveSegLoc(source, scope, "@nudo:contract", line);
    const pos = loc
      ? { line: loc.line, ...(loc.column !== undefined ? { column: loc.column } : {}) }
      : {};
    const parts = line.split(/&&|,/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      // 约束名支持 `ns.foo` 命名空间展开（@nudo:import * as ns）
      const m = part.match(/^(\S+)\s+(\S+)$/);
      if (!m || !isContractSegmentNames(m[1]!, m[2]!)) {
        // 非法契约段（F-3 #6-8：`x > 0` / `x number()` / `x` 单独）→ 不再静默 continue
        // return 段由 extractRefineReturnFromSource 处理，这里不报
        if (/^return\b/.test(part)) continue;
        collectDiag({
          code: DIAG.contractSyntax,
          message: `Malformed @nudo:contract segment '${part}' (expected <param> <constraintName> or return <constraintName>; e.g. @nudo:contract x positive)`,
          ...pos,
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
          code: DIAG.contractSyntax,
          message: `Unknown constraint name '${cName!}' in @nudo:contract (expected a name bound by @nudo:import)`,
          ...pos,
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
 * 返回契约里的 **fn 形态模板** → 真正的返回义务（`fn.returns`）。
 *
 * Bug 351：源码 `@nudo:contract return <fn 形态模板>` 的返回义务整条不被执法
 * ——返回槽装的是整个 fn 约束，而 postcondition 的 fn 分支把 fn 形态直接判
 * 「已证明」。侧车口径（`interface.ts` 的 `sidecarFn?.fn.returns`）取的是
 * **fn.returns** ⇒ 两侧口径必须一致：这里在提取期就拆出 `fn.returns`，
 * 返回槽仍是**单条**（不改公开返回型）。
 *
 * fn 形态但**没有** returns 声明 ⇒ 没有返回义务 ⇒ 返回 undefined。
 */
function returnObligationOf(c: NudoConstraint): NudoConstraint | undefined {
  const d = c;
  if (d.fn === undefined) return d;
  return d.fn.returns;
}

/**
 * 多条返回契约合成**单条合取**（Bug 360）。
 *
 * 旧口径「首个命中即 return」⇒ 多条 `@nudo:contract return` 只执法第一条：
 * 违反第 2 条时 0 error / exit 0（**加一条契约反而让门禁变绿**）。
 * 语义取**合取**——与形参位「同形参多段取合取」的既有语义一致
 * （`interface.ts` 的 `conjoinOrConflict` → `andC`）。
 *
 * 合取能力边界（Phase 1 只支持标量合取）与形参位同口径：
 * - 非标量形态（shape/array/union）⇒ 保既有（第一条），**不**当矛盾
 * - prim 不一致（number ∧ string）⇒ 真矛盾：报 nudo:contract-syntax，
 *   保既有（第一条继续执法）
 */
function conjoinReturnContracts(
  hits: Array<{ name: string; constraint: NudoConstraint }>,
): { name: string; constraint: NudoConstraint } {
  const first = hits[0]!;
  if (hits.length === 1) return first;
  const name = hits.map((h) => h.name).join(" ∧ ");
  let acc = first.constraint;
  for (const h of hits.slice(1)) {
    const c = h.constraint;
    // 非标量形态：合不了（Phase 1 能力边界，不是矛盾）⇒ 保既有
    if (isNonScalarConstraint(acc) || isNonScalarConstraint(c)) continue;
    try {
      acc = andC(acc, c);
    } catch {
      collectDiag({
        code: DIAG.contractSyntax,
        message: `Contradictory @nudo:contract return segments '${name}' (cannot be satisfied together); keeping '${first.name}'`,
      });
      return { name, constraint: first.constraint };
    }
  }
  return { name, constraint: acc };
}

/** 非标量形态（shape / array / union / fn）：Phase 1 的 and() 合不了 */
function isNonScalarConstraint(c: NudoConstraint): boolean {
  return c.fields !== undefined || c.element !== undefined || c.members !== undefined || c.fn !== undefined;
}

/**
 * 解析 `@nudo:contract return positive` → 返回契约。
 * 返回 undefined = 无声明（不猜后置）。
 *
 * Bug 360：多条 return 段**合成单条合取**（不再「首个命中即 return」）。
 * Bug 351：fn 形态模板取其 `fn.returns`（与侧车口径一致，返回义务真被执法）。
 */
export function extractRefineReturnFromSource(
  source: string,
  fnName: string,
  opts: RefineResolveOpts = {},
): { name: string; constraint: NudoConstraint } | undefined {
  if (!stripStringsKeepComments(source).includes("@nudo:contract")) return undefined;
  const constraints = collectConstraints(source, opts);
  const hits: Array<{ name: string; constraint: NudoConstraint }> = [];
  for (const line of extractRefineLines(source, fnName)) {
    const parts = line.split(/&&|,/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const m = part.match(/^return\s+(\S+)$/);
      if (!m || !m[1]!.split(".").every((p) => isJsBindingIdent(p))) {
        // return 段形态非法（如 `return > 0`）→ 诊断
        if (/^return\b/.test(part) && !/^return\s+\S+$/.test(part)) {
          collectDiag({
            code: DIAG.contractSyntax,
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
          code: DIAG.contractSyntax,
          message: `Unknown constraint name '${cName}' in @nudo:contract return (expected a name bound by @nudo:import)`,
        });
        continue;
      }
      const obligation = returnObligationOf(c);
      // fn 形态模板没有 returns 声明 ⇒ 没有返回义务（不进返回槽）
      if (obligation === undefined) continue;
      hits.push({ name: cName, constraint: obligation });
    }
  }
  if (hits.length === 0) return undefined;
  return conjoinReturnContracts(hits);
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
