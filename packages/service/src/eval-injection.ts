/**
 * 行内指令（@nudo:as / @nudo:replace）的**注入表收集器**（叶子模块）。
 *
 * 为什么单独成文件：这个收集器被**两个**转译入口共用——
 * - 根模块：`eval-run.ts` 的 `tryRunEval`（`collectEvalReplacements(source)`）；
 * - 依赖模块：`abs-modules-graph.ts` 的 `tryRunTranspiled`（`resolveEvalInjection(source)`）。
 * 放在 `eval-run.ts` 会形成 `eval-run ↔ abs-modules-graph` 的 ESM 环
 * （函数声明提升 ⇒ 运行时安全，但依赖方向拧巴）；下沉到叶子模块后
 * 两侧都只依赖本模块 ⇒ 无环。
 *
 * 口径：注入表按**源码**采集——同一份源码「作为根」与「作为依赖」得到
 * **同一张表**（Bug 473）。
 */
import { noteEvalFallback, type Abs } from "@nudojs/core";
import { parse, extractInlineDirectives, type DirectiveDiag } from "@nudojs/parser";
import { isStatement } from "@babel/types";

/** 收集结果：@nudo:replace 匹配表 + @nudo:as 覆盖表 */
export type EvalReplacements = {
  /** @nudo:replace 匹配表：每条 = 一个被标注的子表达式节点（字符区间） */
  targets: Array<{
    target: string;
    varName: string;
    stmtStart?: number;
    stmtEnd?: number;
  }>;
  values: Record<string, Abs>;
  /** @nudo:as 覆盖表：每条 = 承载指令的那条语句（字符区间） */
  asTargets: Array<{ varName: string; stmtStart: number; stmtEnd: number }>;
  asValues: Record<string, Abs>;
};

/**
 * 收集 @nudo:replace + @nudo:as → transpile 注入表。
 * `opts.diags`：行内指令文法诊断（nudo:directive-syntax）显式落袋——
 * 语句级抽取各自独立去重；不传则丢弃（纯查询形态）。
 *
 * **作用范围按 AST 节点身份界定**（Bug 166）：登记的是节点的**源文本字符
 * 区间** `[stmtStart, stmtEnd)`，不是行号——
 * - `@nudo:as`：目标是**承载指令的那条语句**；
 * - `@nudo:replace`：目标是该语句子树内、**不跨作用域边界**（嵌套函数/类体/
 *   嵌套语句块）的子表达式节点，逐个登记（同一指令可命中多个节点）。
 * 旧口径是「行号窗口」→ 泄漏进嵌套语句与同行下一条语句（违反文档
 * 「only affects the immediately following statement」）。
 *
 * **遍历覆盖 Statement 节点全集**（Bug 454）：收集器按 AST 结构**通用下钻**
 * （for / for-in / for-of / while / do-while / try / catch / finally / switch /
 * labeled / 箭头函数 / 类方法 …），不再手列容器白名单——写在循环体、try 块、
 * case 分支里的指令此前被**静默丢弃**（零诊断、类型覆盖失效）。
 * 指令挂在**非语句**节点上（表达式属性 / 类方法键等）时无处可施 →
 * 收集表为空则发一条 `nudo:directive-syntax` 显式诊断（不再无声消失）。
 *
 * **目标文本未命中 ⇒ 显式诊断**（Bug 1062）：`@nudo:replace` 的目标文本在
 * 承载语句的作用域内找不到对应节点（写法与源码不符）⇒ 该指令**无效**
 * （转译面永远不命中）⇒ 发一条**点名目标文本**的 `nudo:directive-syntax`
 * ——此前此处**零诊断**（静默失效），唯一信号是归因错误的
 * `nudo:unknown-inference` ⇒ 「写错目标」与「没写指令」不可区分。
 */
export function collectEvalReplacements(
  source: string,
  opts?: { diags?: DirectiveDiag[] },
): EvalReplacements {
  const acc = newAccum();
  try {
    const file = parse(source);
    collectInto(acc, file.program, source, opts);
  } catch (err) {
    // BUG-025：半张注入表比无注入更糟——@nudo:replace/
    // @nudo:as 前几条生效、后几条静默消失，应 exact
    // 的 Abs 变 unknown/真执行。已收集任何 directive
    // 时 rethrow（外层 catch → 整跑 fail-closed：
    // eval-run 返回 undefined / check 注入面报错）；
    // 零收集时 fail-closed 空 maps + noteEvalFallback
    // 记录（无可注入项，throw 前的 parse/访问失败
    // 不影响正确性）。
    if (acc.targets.length > 0 || acc.asTargets.length > 0) {
      throw err;
    }
    noteEvalFallback(err);
  }
  return acc;
}

/**
 * 同款收集，但**复用调用方已解析的 AST**（program 节点）——
 * 调用方（eval-run 的 tryRunEval）同一次 parse 还要取纯函数名，
 * 避免同一份源码被 parse 两次。
 */
export function collectEvalReplacementsFromProgram(
  program: unknown,
  source: string,
  opts?: { diags?: DirectiveDiag[] },
): EvalReplacements {
  const acc = newAccum();
  collectInto(acc, program, source, opts);
  return acc;
}

/** 收集器累加器（表 + 变量名计数器） */
type EvalAccum = {
  targets: EvalReplacements["targets"];
  values: Record<string, Abs>;
  asTargets: EvalReplacements["asTargets"];
  asValues: Record<string, Abs>;
  i: number;
};

function newAccum(): EvalAccum {
  return { targets: [], values: {}, asTargets: [], asValues: {}, i: 0 };
}

/** AST 下钻收集（纯函数；异常上抛给调用方决定 fail-closed 口径） */
function collectInto(
  acc: EvalAccum,
  program: unknown,
  source: string,
  opts?: { diags?: DirectiveDiag[] },
): void {
  // 通用下钻：遍历 AST 全部节点（语句 + 表达式 + 各类容器），
  // 只在**语句载体**上收集行内指令（Bug 454）。
  const seenNodes = new Set<object>();
  /** 指令挂在非语句节点上（无处可施）——收集表为空时上报 */
  const orphanCount = { n: 0 };
  const visitNode = (node: DirectiveStmtNode): void => {
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    if (isDirectiveCarrier(node)) {
      const dirs = extractInlineDirectives(
        node as never,
        opts?.diags ? { diags: opts.diags } : undefined,
      );
      for (const d of dirs) {
        if (d.kind === "replace") {
          const varName = `__rep${acc.i++}`;
          acc.values[varName] = d.typeAbs;
          // 作用域内文本命中的**每个**节点各登记一条（节点身份 = 字符区间）
          const ranges = replaceCandidateRanges(node, source, d.targetSource);
          if (ranges.length === 0) {
            // 目标文本在本语句作用域内**无对应节点**（写法与源码不符）：
            // 登记一条**无作用域**条目——指令仍在场（注入包在场 → B run
            // 不被门禁拦，与旧口径一致），但转译面不命中任何节点。
            acc.targets.push({ target: d.targetSource, varName });
            // Bug 1062：此处此前**零诊断**（静默失效）⇒ 唯一的信号是
            // **归因错误**的 `nudo:unknown-inference`（把「你的指令没生效」
            // 说成「推断精度不够」）⇒ 假红 / 假绿。
            // ⇒ 发一条**显式**诊断（点名目标文本）：②「写错目标」与
            // ③「根本没写这条指令」从此**可区分**。
            // 诊断码复用 `nudo:directive-syntax`（与本文件同族的「指令挂在
            // 非语句节点上 ⇒ 无处可施 ⇒ 指令被忽略」同码）：同族的另外三种
            // 失败形态（类型表达式不认识 / 目标与类型分不开 / 挂在非语句上）
            // 都走这个码 ⇒ 「指令写了但没生效」是同一族。
            opts?.diags?.push({
              code: "nudo:directive-syntax",
              message: `@nudo:replace target "${d.targetSource}" matched no expression in the scope of the statement it annotates — the directive has no effect`,
            });
          } else {
            for (const range of ranges) {
              acc.targets.push({
                target: d.targetSource,
                varName,
                stmtStart: range.start,
                stmtEnd: range.end,
              });
            }
          }
        } else if (d.kind === "as") {
          const varName = `__as${acc.i++}`;
          acc.asValues[varName] = d.typeAbs;
          // @nudo:as 只覆盖**承载指令的那条语句**的 init / return 值
          if (typeof node.start === "number" && typeof node.end === "number") {
            acc.asTargets.push({
              varName,
              stmtStart: node.start,
              stmtEnd: node.end,
            });
          }
        }
      }
    } else if (hasInlineDirectiveComment(node)) {
      orphanCount.n++;
    }
    // 子节点通用下钻（不看节点类型——容器 / 表达式都在其内）
    for (const [k, v] of Object.entries(node)) {
      if (
        k === "loc" ||
        k === "start" ||
        k === "end" ||
        k === "range" ||
        k === "leadingComments" ||
        k === "trailingComments" ||
        k === "innerComments" ||
        k === "comments" ||
        k === "tokens" ||
        k === "extra"
      ) {
        continue;
      }
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object") visitNode(item as DirectiveStmtNode);
        }
      } else if (v && typeof v === "object") {
        visitNode(v as DirectiveStmtNode);
      }
    }
  };
  visitNode(program as DirectiveStmtNode);
  // 静默丢弃 → 可见失败：源码里有行内指令、但一条都没进收集表
  // （指令挂在非语句节点上 / 文法不成立）→ 发显式诊断。
  if (opts?.diags && acc.targets.length === 0 && acc.asTargets.length === 0 && orphanCount.n > 0) {
    opts.diags.push({
      code: "nudo:directive-syntax",
      message:
        "inline directive (@nudo:as / @nudo:replace) is not attached to a statement — it has no effect",
    });
  }
}

/**
 * 转译期注入包（@nudo:replace / @nudo:as 的目标与替换值）。
 * 与 core 的 `RunTranspiledOptions` 同名字段一一对应。
 */
export type EvalInjection = {
  replacementTargets?: Array<{
    target: string;
    varName: string;
    stmtStart?: number;
    stmtEnd?: number;
  }>;
  replacements?: Record<string, Abs>;
  asOverrideTargets?: Array<{ varName: string; stmtStart: number; stmtEnd: number }>;
  asOverrides?: Record<string, Abs>;
};

/**
 * 一份源码的行内指令注入表（Bug 473）。
 *
 * 注入表此前**只对 root source** 采集（tryRunEval 里的
 * `collectEvalReplacements(source)`）——依赖模块走 abs-modules-graph 的
 * 另一条转译入口（`tryRunTranspiled`），**完全不传**注入表 ⇒ 依赖模块里的
 * `@nudo:as` / `@nudo:replace` 被静默忽略：同一个文件「作为根」与「作为
 * 依赖」给出**不同类型**。
 *
 * 装配层（abs-modules-graph）在转译**每个依赖模块**时按其源码取注入表即可闭合：
 *
 * ```ts
 * // packages/service/src/abs-modules-graph.ts（依赖模块转译入口）
 * const inj = resolveEvalInjection(source);
 * const evalRun = tryRunTranspiled(source, { mode: "analyze", modules, ...inj });
 * ```
 *
 * 两处调用点：依赖求值（`evalDep` 的 tryRunTranspiled）与
 * `collectAbsBindingsFromGraph` 的同款转译入口。
 */
export function resolveEvalInjection(source: string): EvalInjection | undefined {
  const { targets, values, asTargets, asValues } = collectEvalReplacements(source);
  if (targets.length === 0 && asTargets.length === 0) return undefined;
  return {
    ...(targets.length > 0 ? { replacementTargets: targets, replacements: values } : {}),
    ...(asTargets.length > 0 ? { asOverrideTargets: asTargets, asOverrides: asValues } : {}),
  };
}

/** 指令语句节点（只取本文件用到的字段） */
type DirectiveStmtNode = {
  type?: string;
  start?: number | null;
  end?: number | null;
  body?: unknown;
  block?: unknown;
  consequent?: unknown;
  alternate?: unknown;
  declaration?: unknown;
  leadingComments?: unknown;
};

/**
 * 语句载体：可承载行内指令的节点（Bug 454）。
 * Babel 的 `Statement` 别名覆盖 for/while/do-while/try/switch/labeled/
 * class/export/import 等全部语句节点——手列容器白名单必然漏（漏掉的
 * 容器里的指令被静默丢弃）。
 * `FunctionExpression` 不是 Statement，但旧口径在函数表达式节点上收集过
 * （其函数体语句此前不可达）——保留以免行为漂移。
 */
function isDirectiveCarrier(node: DirectiveStmtNode): boolean {
  const type = node.type;
  if (typeof type !== "string") return false;
  if (type === "FunctionExpression") return true;
  return isStatement(node as never);
}

/**
 * 节点的前置注释里是否含行内指令（只做文本探测，不解析类型表达式——
 * 避免与 extractInlineDirectives 的文法诊断重复上报）。
 * 挂在**非语句**节点上的指令无处可施（表达式属性 / 类方法键 …）。
 */
function hasInlineDirectiveComment(node: DirectiveStmtNode): boolean {
  const comments = node.leadingComments as
    | Array<{ type?: string; value?: string }>
    | undefined;
  if (!comments || comments.length === 0) return false;
  for (const c of comments) {
    const value = c.value ?? "";
    const kind = c.type === "CommentBlock" ? "block" : "line";
    for (const raw of value.split("\n")) {
      // 与 parser 的 stripInlineCommentPrefix 同口径（块注释 `* ` 续行 /
      // 行注释 `///` 残留的单个 `/`）
      const line = (kind === "block" ? raw.replace(/^\s*\*\s?/, "") : raw.replace(/^\//, ""))
        .trim();
      if (/^@nudo:(?:as|replace)\b/.test(line)) return true;
    }
  }
  return false;
}

/**
 * 指令作用域边界（Bug 166）：嵌套函数/方法/类体（新的函数作用域）与嵌套
 * 语句块（新的语句列表）——指令的作用范围不下钻，否则会泄漏进嵌套语句。
 */
const SCOPE_BOUNDARY_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "StaticBlock",
  "ClassBody",
  "ClassDeclaration",
  "ClassExpression",
  "BlockStatement",
  "SwitchCase",
]);

/** 去全部空白（与 core transpile/helpers.ts 的 normWs 同口径） */
function normWs(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * 指令语句子树内、文本命中 target 的**候选节点区间**（Bug 166）。
 * 不跨作用域边界（SCOPE_BOUNDARY_TYPES）；返回节点的源文本字符区间——
 * 转译面按区间（节点身份）命中，不再按行号窗口。
 */
function replaceCandidateRanges(
  stmt: DirectiveStmtNode,
  source: string,
  target: string,
): Array<{ start: number; end: number }> {
  const want = normWs(target);
  if (want === "") return [];
  const out: Array<{ start: number; end: number }> = [];
  const seen = new Set<object>();
  const walk = (n: DirectiveStmtNode): void => {
    if (seen.has(n)) return;
    seen.add(n);
    if (n.type && SCOPE_BOUNDARY_TYPES.has(n.type)) return;
    const start = n.start;
    const end = n.end;
    if (typeof start === "number" && typeof end === "number" && end > start) {
      // 归一化后长度 ≤ 原文长度：原文更短则不可能命中（省一次切片）
      if (end - start >= want.length && normWs(source.slice(start, end)) === want) {
        out.push({ start, end });
      }
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "range") continue;
      if (k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
      if (k === "comments" || k === "tokens" || k === "extra") continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object" && "type" in (item as object)) {
            walk(item as DirectiveStmtNode);
          }
        }
      } else if (v && typeof v === "object" && "type" in (v as object)) {
        walk(v as DirectiveStmtNode);
      }
    }
  };
  walk(stmt);
  return out;
}
