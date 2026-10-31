/**
 * Abs inlay hint：把无损约束内联到源码位置。
 * 不是 TS 风格 type annotation 复读，而是 term/pred/conf 的计算结果。
 *
 * 参数侧只展示显式 `@nudo:contract` 契约（entryReqs）——
 * 不从函数体 `if` 反推前置条件（那是控制流，不是对外契约）。
 *
 * A7（design-refine-derivation §8）：default 走 symbolic + entryReqs；
 * 与 CodeLens `● interface` 同源——interfaceTierOf 标注来源；
 * implicit 导出的返回 inlay 标明 `derived`（展示档，非义务契约）。
 */

import type { Node, FunctionDeclaration, ClassDeclaration } from "@babel/types";
import { parseSource as parse } from "./parse-source.ts";
import { generalizeFromAst, type PolyFn } from "./generalize.ts";
import { localNamedExports } from "./scan-named-exports.ts";
import { formatShape } from "./format.ts";
import { pTrue, predToString } from "./pred.ts";
import { entrySeedsOfFn } from "./check.ts";
import { withAssumePremises, withInvariantSpecs } from "./exec/runtime/state.ts";
import { termToString, litKeyString, type Term } from "./term.ts";
import { litValue, type Abs } from "./abs.ts";
import { interfaceTierOf, type InterfaceSource, type InterfaceTierOpts } from "./interface.ts";
import type { AbsModuleExports } from "./abs-modules.ts";
import type { RunTranspiledOptions } from "./exec/run.ts";

export type AbsInlay = {
  /** 1-based 行号 */
  line: number;
  /** 0-based 列（label 插入点） */
  character: number;
  label: string;
  kind: "type" | "parameter";
  /** interface 档来源（与 CodeLens `● interface` 同源）；非导出缺省 */
  interfaceSource?: InterfaceSource;
  /** true = 隐式推导展示（非义务契约），label 已带 `· derived` */
  derived?: boolean;
  /** 折叠展示时的完整 pred 文本（hover tooltip；display 缺席时无） */
  tooltip?: string;
};

export type CollectAbsInlaysOpts = InterfaceTierOpts & {
  loadModule?: (spec: string, fromFile: string) => string | undefined;
  fromFile?: string;
  /**
   * eval 模块图（host 组装，如 service `evalAbsModuleGraph`）。缺省时
   * generalizeFromAst 看不到跨模块 import → 调用塌缩 unknown（inlay 假空）。
   */
  modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
  /**
   * B run 注入包（modules / mocks / envGlobals / replacements / as）——
   * 透传给 generalizeFromAst（与 CLI `buildCheckInjection` 产出的 inject
   * 同型）。
   *
   * **缺省 = 行内指令全部缺席**（Bug 786）：`@nudo:mock` 的依赖变成未绑定名、
   * `@nudo:as` / `@nudo:replace` 的覆盖表为空、env 全局未绑定 ⇒ 推导链塌缩成
   * `unknown`（Nudo 词汇里 = 「推断失败」）⇒ IDE 显示 unknown 而 CLI 门禁
   * 显示 number（跨产品面自相矛盾）。调用方（LSP）须与 CLI 同源装配 inject。
   */
  inject?: RunTranspiledOptions;
};

function listFunctions(source: string): Array<{ name: string; node: Node }> {
  const file = parse(source);
  const out: Array<{ name: string; node: Node }> = [];
  /**
   * 导出面（localNamedExports）：CJS 成员导出键（`exports.f` /
   * `module.exports.f`）与导出类实例方法键（`Class.method`）都在里面。
   * 枚举必须与导出面同口径——否则 inlay 面与 CodeLens / hover 面分裂
   * （CJS 成员导出在 inlay 面整段消失，导出类方法只在 hover 面存在）。
   */
  const exported = localNamedExports(source);
  const visitDecl = (decl: Node): void => {
    if (decl.type === "FunctionDeclaration" && (decl as FunctionDeclaration).id) {
      const fd = decl as FunctionDeclaration;
      out.push({ name: fd.id!.name, node: fd });
    }
    if (decl.type === "ClassDeclaration") {
      // 导出类的实例/静态方法 → `Class.method`（契约键同口径，design §3.2）
      const cd = decl as ClassDeclaration;
      const clsName = cd.id?.name;
      if (clsName) {
        for (const m of cd.body?.body ?? []) {
          if (m.type !== "ClassMethod") continue;
          if (m.kind && m.kind !== "method") continue;
          const keyName = m.key?.type === "Identifier" ? m.key.name : undefined;
          if (!keyName) continue;
          const fullName = `${clsName}.${keyName}`;
          if (!exported.has(fullName)) continue;
          out.push({ name: fullName, node: m as Node });
        }
      }
    }
    if (decl.type === "VariableDeclaration") {
      const dcls = (decl as { declarations?: Array<{ id?: { type?: string; name?: string }; init?: Node }> }).declarations ?? [];
      for (const d of dcls) {
        const id = d.id;
        const init = d.init;
        if (
          id?.type === "Identifier" &&
          id.name &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          out.push({ name: id.name, node: init });
        }
      }
    }
    // BUG-147：**匿名 default 导出**（`export default (a) => …` /
    // `export default function (a) {…}`）没有声明节点 ⇒ 上面三个分支全不匹配
    // ⇒ 返回 inlay 整段消失，而同文件 codeLens / hover 有类型（inlay 面自述的
    // 「枚举与导出面同口径」被破）。匿名 default 在 env 里的登记名是 `default`
    // （`generalize.ts` 的 ExportDefaultDeclaration 分支）。
    // 注：`export default function (a) {…}` 在 Babel 里是**无 id 的
    // FunctionDeclaration**（不是 FunctionExpression）⇒ 也要收。
    if (
      decl.type === "ArrowFunctionExpression" ||
      decl.type === "FunctionExpression" ||
      (decl.type === "FunctionDeclaration" && !(decl as FunctionDeclaration).id)
    ) {
      out.push({ name: "default", node: decl });
    }
  };
  /** `exports` / `module.exports` → true */
  const isExportsTarget = (n: Node | undefined): boolean => {
    if (!n) return false;
    if (n.type === "Identifier") return (n as { name?: string }).name === "exports";
    if (n.type === "MemberExpression") {
      const me = n as { object?: Node; property?: Node };
      return (
        me.object?.type === "Identifier" &&
        (me.object as { name?: string }).name === "module" &&
        me.property?.type === "Identifier" &&
        (me.property as { name?: string }).name === "exports"
      );
    }
    return false;
  };
  /** CJS 成员导出：`exports.f = fn` / `module.exports.f = fn`（键名即导出名） */
  const visitCjsAssign = (stmt: Node): void => {
    const expr = (stmt as { expression?: Node }).expression;
    if (!expr || expr.type !== "AssignmentExpression") return;
    const assign = expr as { operator?: string; left?: Node; right?: Node };
    if (assign.operator !== "=") return;
    const left = assign.left;
    const right = assign.right;
    if (!left || !right || left.type !== "MemberExpression") return;
    const me = left as { computed?: boolean; object?: Node; property?: Node };
    if (me.computed === true) return;
    if (!isExportsTarget(me.object)) return;
    const prop = me.property;
    const propName = prop?.type === "Identifier" ? (prop as { name: string }).name : undefined;
    if (!propName) return;
    if (!exported.has(propName)) return;
    if (right.type !== "FunctionExpression" && right.type !== "ArrowFunctionExpression") return;
    out.push({ name: propName, node: right });
  };
  for (const stmt of file.program.body) {
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      visitDecl(stmt.declaration as Node);
    } else if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      visitDecl(stmt.declaration as Node);
    } else if (stmt.type === "ExpressionStatement") {
      visitCjsAssign(stmt as Node);
    } else {
      visitDecl(stmt);
    }
  }
  // BUG-145：**同名槽**（`function f` + `exports.f = …`；类实例方法与静态方法
  // 同名）⇒ 锚点按节点取、取值按名字取（`generalizeFromAst(name)` 按名唯一）
  // ⇒ IDE 里显示**别的函数**的计算式（文件里根本不存在的表达式）。
  // 按名唯一化无法把「名字」还原成「节点」⇒ 同名槽一律**不产 inlay**
  // （宁可少一条提示，也不能渲染别人的计算式）。
  const count = new Map<string, number>();
  for (const e of out) count.set(e.name, (count.get(e.name) ?? 0) + 1);
  return out.filter((e) => count.get(e.name) === 1);
}

/** A1 → 源码参数名，便于 inlay 阅读 */
function renameTypeVars(s: string, varMap: Map<string, string>): string {
  let out = s;
  // 长 id 先替换，避免 A1 误伤 A10
  const ids = [...varMap.keys()].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    out = out.replaceAll(id, varMap.get(id)!);
  }
  return out;
}

/**
 * Bug 412：内部抽象变量名 → 稳定可读标识。
 *
 * `len#N` 由 `exec/runtime/containers/arr-index.ts` 的**模块级自增**计数器
 * `lenVarSeq` 铸造 ⇒ 它既不是用户可见的类型名，又随重算换号（源码级 memo
 * 未命中即递增）⇒ 直接上屏＝「内部 id 泄漏 + 同一份源码两次给出不同文本」。
 *
 * 口径：`len#<数字>` 一律映射成 `len`（稳定、可读）；其它 var（A1 / α 形参名）
 * 原样保留，随后由 `renameTypeVars` 改写成形参名。
 * lit 节点不动 ⇒ 字面量文本（含字符串里的 "len#3"）不受影响。
 */
const INTERNAL_LEN_ID_RE = /^len#\d+$/;
const READABLE_LEN_ID = "len";
/**
 * BUG-247：`@nudo:invariant` 的循环界 term 由 `exec/runtime/invariant-apply.ts`
 * 的模块级计数器铸造（`inv#N`）——内部 id 不是用户面文本（Bug 412 同款），
 * 且编号随重算漂移。它没有可读词根可留，故读值面直接退形状（check 面在
 * 同一位置的签名印的也是形状）。
 */
const INTERNAL_INV_ID_RE = /^inv#\d+$/;

/**
 * term 树里是否藏着 invariant 铸造的内部 id（`inv#N`）。
 *
 * BUG-247（inlay 面）：`@nudo:invariant` 折出的循环值没有可读词根（不像
 * `len#N` 有 `len`）⇒ **不能**上屏 ⇒ 读值面必须**退形状**（check 面在同
 * 一位置印的也是形状）。
 *
 * 旧口径只在**顶层 var** 上判（`m.term.op === "var"`）⇒ 藏在 **app 项**里
 * 的 `inv#N`（`inv#2 + 1`——循环值参与算术）**漏网** ⇒ 内部 id 直接上屏：
 *
 *   : inv#2 + 1 | NaN  · derived
 *
 * 而 check（CLI）面同一位置印的是 `number | NaN` ⇒ 跨面矛盾 + 内部 id 泄漏。
 * ⇒ 判据下沉到**整棵 term 树**：任一层出现 `inv#N` ⇒ 整个 term 退形状。
 */
function hasInternalInvId(t: Term): boolean {
  if (t.op === "var") return INTERNAL_INV_ID_RE.test(t.id);
  if (t.op === "app") return t.args.some(hasInternalInvId);
  return false;
}

function readableTerm(t: Term): Term {
  if (t.op === "var") {
    return INTERNAL_LEN_ID_RE.test(t.id) ? { op: "var", id: READABLE_LEN_ID } : t;
  }
  if (t.op === "app") {
    return { op: "app", fn: t.fn, args: t.args.map(readableTerm) };
  }
  return t;
}

/**
 * 返回值 inlay：路径摘要（对应源码 return），不是精化后的外延类型。
 * `double` → `x | x * 2`；`scale` → `x + 1`。
 * `where` / ToNumber 拆分留给 hover 展开。
 */
function formatReturnDisplay(g: PolyFn): string {
  const varMap = new Map<string, string>();
  for (let i = 0; i < (g.typeParams?.length ?? 0); i++) {
    const id = g.typeParams![i]!.id;
    const pname = g.params[i];
    if (pname) varMap.set(id, pname);
  }

  const stripParens = (t: string): string =>
    t.startsWith("(") && t.endsWith(")") ? t.slice(1, -1) : t;

  /** term → 用户面文本（内部 id 已映射成稳定可读标识；Bug 412） */
  const termText = (t: Term): string =>
    stripParens(renameTypeVars(termToString(readableTerm(t)), varMap));

  const memberPath = (m: Abs): { key: string; text: string } => {
    if (m.term?.op === "var") {
      // 内部 id（len#N）→ 稳定可读标识（Bug 412）；去重键与渲染文本同源
      if (INTERNAL_LEN_ID_RE.test(m.term.id)) {
        return { key: `var:${READABLE_LEN_ID}`, text: READABLE_LEN_ID };
      }
      // BUG-247：invariant 折出的内部 term id 不上屏（无词根可留 ⇒ 退形状）
      if (INTERNAL_INV_ID_RE.test(m.term.id)) {
        const text = formatShape(m);
        return { key: `shape:${text}`, text };
      }
      const name = renameTypeVars(m.term.id, varMap);
      return { key: `var:${name}`, text: name };
    }
    if (m.term?.op === "app") {
      // BUG-247：app 项里藏 `inv#N`（循环值参与算术）⇒ 整个 term 退形状
      // （无词根可留 ⇒ 内部 id 不上屏；与 check 面同位置的形状渲染同源）。
      if (hasInternalInvId(m.term)) {
        const text = formatShape(m);
        return { key: `shape:${text}`, text };
      }
      const t = termText(m.term);
      return { key: `app:${t}`, text: t };
    }
    const lvR = litValue(m);
    // 「是否字面量」看 ok：lit(undefined) 也是字面量，不得用 value !== undefined 门闩。
    if (lvR.ok) {
      const lv = lvR.value;
      // 规范口径（Bug 414）：字面量文本走仓库既有渲染（`term.ts` 的
      // `termToString` / `litKeyString`，与 `format.ts` 的 `formatLitValue`
      // 同口径）——`JSON.stringify(-0)` 会把负零抹成 "0"（-0 与 0 在
      // Object.is / 1/x 上可观察不同）。
      const text = termToString({ op: "lit", value: lv });
      // 去重键与渲染文本**同源**（否则 `-0` 臂与 `0` 臂键相同 ⇒ `seen`
      // 把其中一条整个丢掉）；`typeof` 前缀区分 `lit("10")` / `lit(10)`。
      const key = `lit:${typeof lv}:${litKeyString(lv)}`;
      return { key, text };
    }
    return { key: `shape:${formatShape(m)}`, text: formatShape(m) };
  };

  const abs = g.symbolic;
  // 外层 term：单路径计算形（`x + 1`）
  // BUG-247：外层 term 里藏 `inv#N` ⇒ 退形状（内部 id 不上屏；与 check 面
  // 同一位置的形状渲染同源 ⇒ IDE 两面不再互斥）。
  if (abs.term && abs.term.op !== "lit" && !hasInternalInvId(abs.term)) {
    return termText(abs.term);
  }
  if (abs.shape.k === "sum") {
    // 同 term 的精化臂（number>3 | string 都是 A1）合并为一条路径 `x`
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const m of abs.shape.members) {
      const { key, text } = memberPath(m);
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(text);
    }
    return parts.join(" | ");
  }
  return memberPath(abs).text;
}

/**
 * 收集源码中函数签名的 Abs inlay：
 * - 参数后：仅 `@nudo:contract` / 侧车显式契约（entryReqs）
 * - `{` 前：返回计算形（`x | x * 2`），无 term 时退回 shape
 * - interface 档：导出函数带 `interfaceSource`；implicit 返回标 `derived`
 */
export function collectAbsInlays(
  source: string,
  opts?: CollectAbsInlaysOpts,
): AbsInlay[] {
  const inlays: AbsInlay[] = [];
  const refineOpts =
    opts?.loadModule || opts?.fromFile
      ? {
          ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
          ...(opts.fromFile ? { fromFile: opts.fromFile } : {}),
          ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
        }
      : undefined;

  for (const { name, node } of listFunctions(source)) {
    let g: ReturnType<typeof generalizeFromAst>;
    try {
      const generalize = () =>
        generalizeFromAst(name, source, {
          ...(refineOpts ? { refine: refineOpts } : {}),
          ...(opts?.modules ? { modules: opts.modules } : {}),
          // 注入包透传（Bug 786）：@nudo:mock / @nudo:as / @nudo:replace /
          // env 全局缺席 ⇒ 推导链塌缩 unknown（与 CLI 面分叉）。
          ...(opts?.inject ? { inject: opts.inject } : {}),
        });
      // BUG-247：`@nudo:assume`（引理前提）/ `@nudo:invariant`（循环界）是
      // **求值动态域**的种子——checkSource 播种后才折出 `0 | number`。inlay
      // 自算 generalize 若不播种，同一文件的角标与 CLI `check` 签名跨面矛盾
      // （IDE 印出「没有那条公理的程序」的类型）。种子非平凡时
      // generalizeFromAst 自动绕过 L0（见其注释），不污染无种子上下文。
      const seed = entrySeedsOfFn(name, source);
      g =
        seed.assumePhi !== undefined || seed.invSpecs.length > 0
          ? withAssumePremises(seed.assumePhi ?? pTrue, () =>
              withInvariantSpecs(seed.invSpecs, generalize),
            )
          : generalize();
    } catch {
      continue;
    }
    if (!g) continue;

    // A7：与 CodeLens `● interface` 同源；仅本地 named export 进档
    const tier =
      opts?.fromFile !== undefined
        ? interfaceTierOf(source, name, opts.fromFile, {
            ...(opts.loadModule ? { loadModule: opts.loadModule } : {}),
            ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
          })
        : undefined;
    const tierSrc = tier?.source;
    const isImplicitExport = tierSrc === "implicit";

    const params = g.params;
    const predsByName = new Map<string, Array<{ pred: import("./pred.ts").Pred; display?: string }>>();
    if (g.entryReqs) {
      for (const r of g.entryReqs) {
        predsByName.set(r.param, [
          { pred: r.pred, ...(r.display !== undefined ? { display: r.display } : {}) },
        ]);
      }
    }

    type FnNodeLike = {
      params?: Array<{ name?: string; loc?: { end: { line: number; column: number } } }>;
      body?: {
        /** Babel 节点判别式：`BlockStatement` = 块体，其余 = 表达式体 */
        type?: string;
        loc?: {
          start?: { line: number; column: number };
          end?: { line: number; column: number };
        };
      };
    };
    const fnNode = node as FnNodeLike;
    const paramList = fnNode.params ?? [];
    for (let i = 0; i < paramList.length; i++) {
      const p = paramList[i];
      const pname = params[i] ?? (p?.name as string | undefined);
      if (!p?.loc || !pname) continue;
      const preds = predsByName.get(pname);
      if (preds && preds.length > 0) {
        const text = preds.map((p) => predToString(p.pred)).join(" ∧ ");
        // 运行时标志折叠：表达式原文/约束名替代 pred 无损展开
        // （lazy 判别联合展开可达数万字符）；完整 pred 进 tooltip
        // 供 hover 展开。任一 pred 无 display → 整体回落全展。
        const displays = preds.map((p) => p.display);
        const display = displays.every((d) => d !== undefined)
          ? displays.map((d) => d!).join(" ∧ ")
          : undefined;
        inlays.push({
          line: p.loc.end.line,
          character: p.loc.end.column,
          label: display !== undefined ? `  where ${display}` : `  where ${text}`,
          kind: "parameter",
          ...(display !== undefined ? { tooltip: text } : {}),
          ...(tierSrc ? { interfaceSource: tierSrc } : {}),
        });
      }
    }

    /**
     * 返回 inlay 的锚点（Bug 408）：
     * - **块体**（`BlockStatement`）⇒ `{` 的位置（标注插在 `{` 前，正确）。
     * - **表达式体** ⇒ 整个表达式的**结束**位置（标注落在表达式之后）。
     *
     * 改前无条件取 `body.loc.start`：对块体它等于 `{`（正确），对**表达式体**
     * 它等于**表达式的起点** ⇒ 标注被插到 `=>` 与表达式之间，把源码行劈开
     * （`export const arrow = (v) => : v * 2  v * 2;`）。
     * 口径同 TypeScript 自身的返回类型 inlay（提示落在被标注表达式之后）。
     */
    const bodyNode = fnNode.body;
    const bodyLoc = bodyNode?.loc;
    const anchor =
      bodyNode?.type === "BlockStatement"
        ? bodyLoc?.start
        : (bodyLoc?.end ?? bodyLoc?.start);
    if (anchor) {
      let label: string;
      try {
        label = `: ${formatReturnDisplay(g)}`;
      } catch {
        label = `: ${formatShape(g.symbolic)}`;
      }
      if (isImplicitExport) label += "  · derived";
      inlays.push({
        line: anchor.line,
        character: Math.max(0, anchor.column),
        label: `${label}  `,
        kind: "type",
        ...(tierSrc ? { interfaceSource: tierSrc } : {}),
        ...(isImplicitExport ? { derived: true } : {}),
      });
    }
  }
  return inlays;
}
