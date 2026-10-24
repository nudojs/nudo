/**
 * action-map 物化层（#69）：CheckAction.kind + 诊断码 → 可应用的文本编辑。
 * LSP quickfix 与 `nudo check --fix` 共用；标题区分 fix / silence / review。
 *
 * 空 shape 禁令：body-read 为空时不得生成 `shape({})`（会塌签名）。
 *
 * 注解定位不变量：函数级指令（`@nudo:throws` / `@nudo:budget`）只被**声明上方
 * 附着**的 JSDoc 采信 ⇒ 编辑必须落在附着 JSDoc 内部（无 JSDoc 则插完整块），
 * 绝不产出裸 tag（那是语法错误）。声明按**作用域**定位（模块顶层同名声明），
 * 同名局部绑定不是目标。
 *
 * 侧车不变量：`.nudo.ts` 侧车自带 builder import（TS 类型关键字构建器改名
 * 导入）；`.nudo.js` 侧车维持「裸注入」。nullish 改写只动 return 位（第三实参
 * 等其余实参原样保留），且证不出门禁转绿时降级 review 不自动落盘。
 */
import type { CheckAction } from "@nudojs/core";
import { checkSource, pTrue } from "@nudojs/core";
import { DIAG, isJsBindingIdent } from "@nudojs/core/internal";
import { parse } from "@nudojs/parser";
import type { Node } from "@babel/types";
import {
  collectParamContracts,
  contractDslOf,
  shapeDslFromFields,
  type BodyReadField,
} from "./body-read-types.ts";
import { allocNudoBinding, exportNameRepr } from "./export-binding.ts";

export type QuickfixTitleKind = "fix" | "silence" | "review" | "adjust" | "scaffold";

export type TextEdit = {
  /** 0-based */
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  newText: string;
};

export type QuickfixPlan = {
  titleKind: QuickfixTitleKind;
  title: string;
  /** 相对 file 的编辑 */
  edits: TextEdit[];
  /** 侧车整文件替换（新建/改写 *.nudo.js） */
  sidecar?: { path: string; newText: string };
  /** 需要额外打开/创建的文件路径 */
  openPath?: string;
};

function titlePrefix(k: QuickfixTitleKind): string {
  return `[${k}]`;
}

/** kind → 标注（Fix all 不得把 silence 当修复） */
export function titleKindFor(code: string, action: CheckAction): QuickfixTitleKind {
  switch (action.kind) {
    case "draft":
      return "fix";
    case "relax":
      return code === DIAG.unprovenReturn ? "review" : "silence";
    case "mock":
    case "assume":
    case "emit":
      return "scaffold";
    case "ignore-throws":
      return "silence";
    case "callsite":
      return "fix";
    default:
      return "adjust";
  }
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 作用域感知的函数声明定位（Bug 558）。
 *
 * 旧实现按**名字**做行级正则匹配（首个命中即返回）：别的函数体里的同名
 * 局部绑定（`const alpha = 1`）也会命中 ⇒ `@nudo:throws` 注解落进**别的
 * 函数体** ⇒ 指令扫描器不采信函数体内的 JSDoc ⇒ quickfix 点了也没用
 * （门禁纹丝不动）。
 *
 * 新实现走 AST：只在**模块顶层**找与 fnName 精确相等的声明：
 * - `function f(…)` / `export function f(…)`
 * - `const f = <函数/箭头>` / `export const f = <函数/箭头>`
 *   （`const` 支收紧为「该绑定**就是**目标函数的声明」：初始化式必须是函数）
 * 同名的**局部**绑定不再命中。
 *
 * 返回声明所在行号（0-based）；找不到 → -1。
 */
function findFnDeclLine(source: string, fnName: string): number {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source);
  } catch {
    return -1;
  }
  const body = (ast as { program?: { body?: Node[] } }).program?.body ?? [];
  const lineOf = (node: Node): number => {
    const start = (node as { start?: number | null }).start;
    if (typeof start !== "number") return -1;
    let line = 0;
    for (let i = 0; i < start && i < source.length; i++) {
      if (source[i] === "\n") line++;
    }
    return line;
  };
  for (const stmt of body) {
    const decl =
      stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
        ? (stmt as { declaration?: Node }).declaration
        : stmt;
    if (!decl) continue;
    if (decl.type === "FunctionDeclaration") {
      const id = (decl as { id?: { name?: string } | null }).id;
      if (id?.name === fnName) return lineOf(decl);
      continue;
    }
    if (decl.type === "VariableDeclaration") {
      const decls = (decl as { declarations?: Array<{ id?: Node; init?: Node }> }).declarations ?? [];
      for (const d of decls) {
        if (d.id?.type !== "Identifier") continue;
        if ((d.id as { name: string }).name !== fnName) continue;
        // `const f = …` 支：初始化式必须是函数/箭头——否则那是普通绑定，
        // 不是目标函数的声明（局部同名 const 正是 Bug 558 的触发形态）
        if (d.init?.type !== "ArrowFunctionExpression" && d.init?.type !== "FunctionExpression") {
          continue;
        }
        return lineOf(decl);
      }
    }
  }
  return -1;
}

/**
 * 在源码中找 `function <fn>` / `export function <fn>` / `const <fn> =` 的 JSDoc/声明行。
 *
 * 定位按**作用域**（模块顶层同名声明，见 findFnDeclLine）：同名的局部绑定
 * （别的函数体里的 `const f = …`）不再命中（Bug 558）。
 */
export function findFnDeclStart(lines: string[], fnName: string): number {
  const decl = findFnDeclLine(lines.join("\n"), fnName);
  if (decl < 0) return -1;
  // 回溯 JSDoc（保持既有语义：返回附着的 JSDoc/行注释起点，否则返回声明行）
  let j = decl - 1;
  while (
    j >= 0 &&
    (lines[j]!.trim() === "" ||
      lines[j]!.trim().startsWith("*") ||
      lines[j]!.trim().startsWith("/*") ||
      lines[j]!.trim().startsWith("//"))
  ) {
    if (lines[j]!.includes("/**") || lines[j]!.trim().startsWith("//")) return j;
    j--;
  }
  return decl;
}

/**
 * 声明行上方**附着**的 JSDoc 块（Bug 513）。
 *
 * 只认「声明正上方的注释块」：底行必须是 JSDoc 的收尾标记，或单行 JSDoc
 * （开标记与收标记同行），再向上找配对的开标记。普通块注释与行注释
 * 都不是 JSDoc ⇒ 不认。
 *
 * 旧实现从声明行**向下**扫「首个含收尾标记的行」当 JSDoc 收尾——普通块
 * 注释同样含收尾标记 ⇒ 裸 tag（无 JSDoc 外壳）被插到注释之外 ⇒ 文件语法
 * 错误（Bug 513）。
 */
function findAttachedJsDoc(
  lines: string[],
  decl: number,
): { open: number; close: number } | undefined {
  let bottom = -1;
  for (let j = decl - 1; j >= 0; j--) {
    if (lines[j]!.trim() === "") continue;
    bottom = j;
    break;
  }
  if (bottom < 0) return undefined;
  const bottomText = lines[bottom]!;
  const closeIdx = bottomText.indexOf("*/");
  const openIdx = bottomText.indexOf("/**");
  // 单行 JSDoc：`/** … */` 同在一行 → 展开成块
  if (openIdx !== -1 && closeIdx > openIdx) return { open: bottom, close: bottom };
  // 多行 JSDoc：底行必须是 `*/` 收尾
  if (closeIdx === -1) return undefined;
  // 向上找配对的 `/**`（其间只允许空行与 `*` 续行）
  for (let k = bottom - 1; k >= 0; k--) {
    const tk = lines[k]!.trim();
    if (tk.startsWith("/**")) return { open: k, close: bottom };
    if (tk === "" || tk.startsWith("*")) continue;
    return undefined;
  }
  return undefined;
}

/**
 * 在函数 JSDoc 里插入一行 `@nudo:throws <Kind>`（已存在则不重复）。
 *
 * 插入点必须落在**注释内部**（Bug 513）：
 * - 有附着 JSDoc：单行 JSDoc 展开成块；多行在收尾标记所在行之前插入 tag。
 * - 无附着 JSDoc：在声明行之前插入完整 JSDoc 块。
 * 任何情况下都**不**产出裸 tag（无注释外壳）——那会把文件改成语法错误。
 */
export function addThrowsAnnotation(
  source: string,
  fnName: string,
  kind: string,
): { edits: TextEdit[] } | undefined {
  const lines = source.split("\n");
  const decl = findFnDeclLine(source, fnName);
  if (decl < 0) return undefined;
  const kindSafe = kind.replace(/[^\w.$]/g, "") || "Error";
  const tag = ` * @nudo:throws ${kindSafe}`;
  const doc = findAttachedJsDoc(lines, decl);
  // 已有 `@nudo:throws <kind>` → 不重复（no-op）
  const scanFrom = Math.max(0, decl - 20);
  const scanTo = Math.min(lines.length, decl + 3);
  for (let i = scanFrom; i < scanTo; i++) {
    if (lines[i]!.includes(`@nudo:throws ${kindSafe}`)) return { edits: [] };
  }
  if (doc) {
    if (doc.open === doc.close) {
      // 单行 JSDoc：展开成块，避免 tag 被插到 `/**` 之前
      const t = lines[doc.open]!;
      const openIdx = t.indexOf("/**");
      const closeIdx = t.indexOf("*/");
      const inner = t.slice(openIdx + 3, closeIdx).trim();
      const innerLine = inner ? ` * ${inner}\n` : "";
      return {
        edits: [
          {
            startLine: doc.open,
            startCol: 0,
            endLine: doc.open,
            endCol: t.length,
            newText: `/**\n${innerLine}${tag}\n */`,
          },
        ],
      };
    }
    // 多行 JSDoc：在 `*/` 行之前插入 tag（注释内部 ⇒ 文件仍可解析）
    return {
      edits: [
        {
          startLine: doc.close,
          startCol: 0,
          endLine: doc.close,
          endCol: 0,
          newText: `${tag}\n`,
        },
      ],
    };
  }
  // 无 JSDoc：在声明前插入完整块
  return {
    edits: [
      {
        startLine: decl,
        startCol: 0,
        endLine: decl,
        endCol: 0,
        newText: `/**\n${tag}\n */\n`,
      },
    ],
  };
}

/**
 * 枚举侧车里全部 `export { … }` 子句的逐 specifier 文本（已 trim）。
 * 逐字符扫描而非正则/朴素 split：写出面 exportNameRepr 对非标识符导出名
 * 发射 JSON 引号串（`export { _nudo_1 as "a,b" }` 是合法产物）——字符串
 * 字面量内的 `}` / `,` 不是定界符，正则 `\{([^}]*)\}` 提前截断、
 * split(",") 切进引号会让该形态静默解析失败（quickfix no-op）。
 */
function* exportSpecifierParts(src: string): Generator<string> {
  const re = /\bexport\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const parts: string[] = [];
    let cur = "";
    let quote: '"' | "'" | undefined;
    let close = -1;
    for (let i = m.index + m[0].length; i < src.length; i++) {
      const ch = src[i]!;
      if (quote !== undefined) {
        cur += ch;
        if (ch === "\\") {
          if (i + 1 < src.length) cur += src[i + 1]!;
          i++;
        } else if (ch === quote) {
          quote = undefined;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
      } else if (ch === ",") {
        parts.push(cur);
        cur = "";
      } else if (ch === "}") {
        parts.push(cur);
        cur = "";
        close = i;
        break;
      } else {
        cur += ch;
      }
    }
    if (close === -1) break; // 未闭合子句不产出（与旧正则 `[^}]*\}` 同口径）
    re.lastIndex = close + 1; // 越过已消费的 `}`，子句内（含字符串里的）不重扫
    for (const p of parts) yield p.trim();
  }
}

/**
 * 侧车里导出名 → 模块绑定名（DESIGN-003 别名段：`export { _nudo_1 as class }`）。
 * 查找键恒为**导出名**（身份）；直接同名 / 非别名形态 → undefined。
 */
export function sidecarBindingFor(sidecarSource: string, exportName: string): string | undefined {
  for (const t of exportSpecifierParts(sidecarSource)) {
    if (!t) continue;
    const asMatch = /^([\w$]+)\s+as\s+(.+)$/.exec(t);
    if (!asMatch) continue;
    const local = asMatch[1]!;
    let exported = asMatch[2]!.trim();
    if (exported.startsWith('"') || exported.startsWith("'")) {
      try {
        exported = JSON.parse(exported.replace(/^'|'$/g, '"')) as string;
      } catch {
        continue;
      }
    }
    if (exported === exportName) return local;
  }
  return undefined;
}

/**
 * 定位侧车里目标契约的声明起点：`export const <name> = fn(` / `<name> = fn(`。
 * DESIGN-003：查找键恒为**导出名**（身份）——别名段先经 sidecarBindingFor
 * 解析绑定（`const _nudo_1 = fn(…); export { _nudo_1 as class }`）。
 * 返回声明 start 与 fn 调用开括号位置；找不到 → undefined。
 */
export function matchSidecarFnDecl(
  sidecarSource: string,
  exportName: string,
): { start: number; openParen: number } | undefined {
  const fn = escapeRegExp(exportName);
  const startRe = new RegExp(
    `(?:export\\s+const\\s+${fn}\\s*=\\s*|(?<![\\w$])${fn}\\s*=\\s*)fn\\s*\\(`,
  );
  let m = sidecarSource.match(startRe);
  if (!m || m.index === undefined) {
    const binding = sidecarBindingFor(sidecarSource, exportName);
    if (binding === undefined) return undefined;
    m = sidecarSource.match(
      new RegExp(`(?<![\\w$])${escapeRegExp(binding)}\\s*=\\s*fn\\s*\\(`),
    );
  }
  if (!m || m.index === undefined) return undefined;
  return { start: m.index, openParen: m.index + m[0].lastIndexOf("(") };
}

/**
 * 扫描 `fn(...)` 的实参区：返回配对右括号位置与**顶层**逗号位置。
 *
 * 字符串字面量（含模板串）与注释里的括号/逗号不是定界符——侧车 DSL 里
 * `lit("a,b")` 这类字面量必须整段跳过，否则实参切分会切错。
 */
function scanCallArgs(src: string, open: number): { end: number; commas: number[] } | undefined {
  let depth = 0;
  const commas: number[] = [];
  let quote: '"' | "'" | "`" | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && src[i + 1] === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== undefined) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return { end: i, commas };
      continue;
    }
    if (ch === "," && depth === 1) commas.push(i);
  }
  return undefined;
}

/**
 * 侧车 return 契约包一层 `nullable(...)`（nullish 臂违例的机械修法）。
 * 只改目标 fn 的 **return 位**（第二个顶层实参）。
 *
 * Bug 556：旧实现取「首个顶层逗号」与「`fn(...)` 收尾括号」之间的**全部**
 * 文本当 return 位 ⇒ 第三个实参（`{ throws: "Error" }` 这类 throws 义务）
 * 被一起卷进 `nullable(...)` ⇒ throws 义务被静默吞掉 ⇒ 门禁从
 * `constraint-violated` 变成 `entry-may-throw`（错误码都变了：用户以为
 * 修好了，其实是换了个红）。
 * ⇒ 按**顶层实参**切分：第二个实参是 return 位，第三个实参**原样保留**。
 */
export function wrapReturnNullable(
  sidecarSource: string,
  fnName: string,
): string | undefined {
  const located = matchSidecarFnDecl(sidecarSource, fnName);
  if (located === undefined) return undefined;
  const scanned = scanCallArgs(sidecarSource, located.openParen);
  if (scanned === undefined) return undefined;
  const { end, commas } = scanned;
  if (commas.length === 0) return undefined; // 无 return 位
  let retStart = commas[0]! + 1;
  while (retStart < end && /\s/.test(sidecarSource[retStart]!)) retStart++;
  let retEnd = commas.length >= 2 ? commas[1]! : end;
  while (retEnd > retStart && /\s/.test(sidecarSource[retEnd - 1]!)) retEnd--;
  const retExpr = sidecarSource.slice(retStart, retEnd);
  if (!retExpr || retExpr.startsWith("nullable(") || retExpr.startsWith("union(")) {
    return undefined;
  }
  const next =
    sidecarSource.slice(0, retStart) +
    `nullable(${retExpr})` +
    sidecarSource.slice(retEnd);
  return next;
}

/** `@nudo:budget forks=N` 注解 */
export function addBudgetAnnotation(
  source: string,
  fnName: string,
  forks = 64,
): { edits: TextEdit[] } | undefined {
  const lines = source.split("\n");
  const start = findFnDeclStart(lines, fnName);
  if (start < 0) return undefined;
  if (source.includes(`@nudo:budget`)) return { edits: [] };
  return {
    edits: [
      {
        startLine: start,
        startCol: 0,
        endLine: start,
        endCol: 0,
        newText: `/**\n * @nudo:budget forks=${forks}\n */\n`,
      },
    ],
  };
}

/** 把 edits 应用到源码（按 start 从后往前） */
export function applyTextEdits(source: string, edits: TextEdit[]): string {
  const lines = source.split("\n");
  const sorted = [...edits].sort(
    (a, b) => b.startLine - a.startLine || b.startCol - a.startCol,
  );
  for (const e of sorted) {
    const before = lines.slice(0, e.startLine);
    const after = lines.slice(e.endLine + 1);
    const startLineText = lines[e.startLine] ?? "";
    const endLineText = lines[e.endLine] ?? startLineText;
    const merged =
      startLineText.slice(0, e.startCol) + e.newText + endLineText.slice(e.endCol);
    lines.splice(e.startLine, e.endLine - e.startLine + 1, merged);
  }
  return lines.join("\n");
}

export type MaterializeInput = {
  code: string;
  fn?: string;
  file: string;
  source: string;
  sidecarText?: string;
  sidecarPath: string;
  action: CheckAction;
  /** 诊断里的 throws 类型（entry-may-throw） */
  throwsKind?: string;
  expected?: string;
  suggestion?: string;
  /** 截断归因（nudo:recursion-truncated；#158）：cycle 时抬预算无效 */
  reason?: string;
  /**
   * 宿主模块加载器（CLI 的 defaultLoadModule）：侧车契约验证重分析时
   * 供源文件相对依赖解析。缺省只验证 source+侧车合成内容（依赖 miss →
   * 验证保守降级 review，不会误放行）。
   */
  loadModule?: (spec: string, from: string) => string | undefined;
};

/**
 * 侧车契约验证底座：把合成侧车作为**唯一**侧车来源重跑 checkSource。
 *
 * 侧车路径的相对说明符被拦下换成合成内容（源文件相对依赖仍走宿主加载器）。
 * 任何失败（求值抛 / interface-load）按「证不出」处理 → undefined。
 */
function checkWithSynthesizedSidecar(input: {
  file: string;
  source: string;
  sidecarPath: string;
  sidecarText: string;
  loadModule?: (spec: string, from: string) => string | undefined;
}): ReturnType<typeof checkSource> | undefined {
  const norm = (p: string): string => p.replace(/\\/g, "/");
  const resolveRel = (from: string, spec: string): string | undefined => {
    if (!spec.startsWith(".")) return undefined;
    const parts = norm(from).split("/").slice(0, -1);
    for (const seg of norm(spec).split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };
  const target = norm(input.sidecarPath);
  const loadModule = (spec: string, from: string): string | undefined => {
    const p = resolveRel(from, spec);
    if (p !== undefined && p === target) return input.sidecarText;
    return input.loadModule?.(spec, from);
  };
  try {
    const r = checkSource(input.file, input.source, pTrue, {
      loadModule,
      fromFile: input.file,
    });
    if (r.issues.some((i) => i.code === DIAG.interfaceLoad)) return undefined;
    return r;
  } catch {
    return undefined;
  }
}

/**
 * 侧车契约验证（entry-may-throw 的 [fix] 门）：把合成侧车作为唯一侧车
 * 来源重跑 checkSource，确认目标函数的 L2 entry-may-throw 消失。
 * 引擎证不出 total（回调体算术面不 total / 元素字段 any 被继续调用等）
 * → false：编辑降级 [review]，不得挂 fix 名自动落盘（半修复不可接受）。
 * 任何失败（求值抛 / interface-load）按未通过处理。
 */
export function sidecarClearsEntryThrow(input: {
  file: string;
  source: string;
  sidecarPath: string;
  sidecarText: string;
  fn: string;
  loadModule?: (spec: string, from: string) => string | undefined;
}): boolean {
  const r = checkWithSynthesizedSidecar(input);
  if (r === undefined) return false;
  return !r.issues.some(
    (i) => i.code === DIAG.entryMayThrow && i.fn === input.fn,
  );
}

/**
 * 侧车契约验证（constraint-violated 的 [fix] 门）：合成侧车重跑 checkSource，
 * 确认目标函数的 constraint-violated **与** entry-may-throw 都消失。
 *
 * Bug 556：旧 quickfix 只卷 return 位，把第三个实参（throws 义务）一起吞进
 * `nullable(...)` ⇒ 门禁从 constraint-violated 变成 entry-may-throw ⇒
 * 「修好了」其实是「换了个红」。⇒ 两个诊断都查：任一残留 → 降级 [review]，
 * 不自动落盘。
 */
export function sidecarClearsConstraintViolation(input: {
  file: string;
  source: string;
  sidecarPath: string;
  sidecarText: string;
  fn: string;
  loadModule?: (spec: string, from: string) => string | undefined;
}): boolean {
  const r = checkWithSynthesizedSidecar(input);
  if (r === undefined) return false;
  return !r.issues.some(
    (i) =>
      (i.code === DIAG.constraintViolated || i.code === DIAG.entryMayThrow) &&
      i.fn === input.fn,
  );
}

/**
 * quickfix 侧车 DSL 可能用到的构建器（与 interface-draft 的 BUILDERS 同族知识）。
 */
const SIDECAR_BUILDERS = [
  "fn",
  "number",
  "string",
  "boolean",
  "any",
  "shape",
  "array",
  "lit",
  "union",
  "nullable",
] as const;

/**
 * TS 类型关键字构建器：`any` / `number` / `string` / `boolean` 在 TypeScript
 * 里是**类型**关键字，当值用会报 TS2693（`'any' only refers to a type,
 * but is being used as a value here`）⇒ TS 侧车里必须改名导入。
 */
const TS_KEYWORD_BUILDERS = new Set(["any", "boolean", "number", "string"]);

/** 改名导入的本地名前缀（避开用户既有绑定） */
const SIDECAR_ALIAS_PREFIX = "_nudo_";

/** 侧车是不是 TS 侧车（`*.nudo.ts`）——TS 侧车必须自带 builder import */
function isTsSidecar(path: string): boolean {
  return /\.ts$/i.test(path);
}

/**
 * TS 侧车（`*.nudo.ts`）的 builder import + DSL 改写（Bug 546）。
 *
 * `.nudo.ts` 是 TypeScript 文件：裸 DSL（`fn({ x: shape({ toFixed: any() }) })`）
 * 既缺 import（TS2304: Cannot find name 'fn'）又撞 TS 类型关键字（TS2693）
 * ⇒ 产物过不了 `tsc --noEmit --strict`。
 * ⇒ 只 import DSL 真正用到的构建器；TS 类型关键字构建器改名导入
 *   （`any as _nudo_any`）并同步改写 DSL。
 *
 * 已有侧车：先读它自己从 `@nudojs/core` import 了哪些构建器（按**本地名**
 * 口径）——已覆盖的不重复 import；未覆盖的补一条（本地名被占用时改名，
 * 避免撞名）。`.nudo.js` 侧车维持「裸注入」纪律（引擎运行时注入构建器），
 * 不加 import。
 */
function tsSidecarBuilderImport(
  dsl: string,
  existing: string | undefined,
): { importLine: string | undefined; dsl: string } {
  const used = SIDECAR_BUILDERS.filter((b) =>
    new RegExp(`(?<![\\w$])${b}(?![\\w$])\\s*\\(`).test(dsl),
  );
  if (used.length === 0) return { importLine: undefined, dsl };
  const existingText = existing ?? "";
  // 已有侧车从 `@nudojs/core` 导入的构建器 → 本地名
  const provided = new Map<string, string>();
  const importRe = /import\s*\{([^}]*)\}\s*from\s*["']@nudojs\/core["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(existingText)) !== null) {
    for (const part of m[1]!.split(",")) {
      const spec = part.trim();
      if (!spec) continue;
      const as = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(spec);
      if (as) provided.set(as[1]!, as[2]!);
      else if (/^[\w$]+$/.test(spec)) provided.set(spec, spec);
    }
  }
  const specs: string[] = [];
  const alias = new Map<string, string>();
  for (const b of used) {
    const local = provided.get(b);
    if (local !== undefined) {
      alias.set(b, local);
      continue;
    }
    let name = TS_KEYWORD_BUILDERS.has(b) ? `${SIDECAR_ALIAS_PREFIX}${b}` : b;
    if (
      name === b &&
      new RegExp(`(?<![\\w$])${b}(?![\\w$])`).test(existingText)
    ) {
      name = `${SIDECAR_ALIAS_PREFIX}${b}`; // 本地名已被占用 → 改名
    }
    alias.set(b, name);
    specs.push(name === b ? b : `${b} as ${name}`);
  }
  const importLine =
    specs.length > 0 ? `import { ${specs.join(", ")} } from "@nudojs/core";` : undefined;
  // DSL 改写：只改构建器**调用名**（字段名不带 `(`，不受影响）
  let out = dsl;
  for (const [b, local] of alias) {
    if (local === b) continue;
    out = out.replace(
      new RegExp(`(?<![\\w$])${b}(?![\\w$])\\s*\\(`, "g"),
      `${local}(`,
    );
  }
  return { importLine, dsl: out };
}

/**
 * kind → WorkspaceEdit 物化。返回 undefined = 该 action 只读（info）或缺证据。
 */
export function materializeAction(input: MaterializeInput): QuickfixPlan | undefined {
  const { code, action, fn, source, sidecarText, sidecarPath } = input;
  const tk = titleKindFor(code, action);

  // —— entry-may-throw：@nudo:throws（silence）——
  if (code === DIAG.entryMayThrow && action.kind === "relax" && fn) {
    const kind =
      input.throwsKind ??
      input.suggestion?.match(/@nudo:throws\s+(\w+)/)?.[1] ??
      "Error";
    const r = addThrowsAnnotation(source, fn, kind);
    if (!r) return undefined;
    return {
      titleKind: "silence",
      title: `${titlePrefix("silence")} Declare @nudo:throws ${kind} on ${fn}`,
      edits: r.edits,
    };
  }

  // —— entry-may-throw：侧车 param contract（fix）——
  // 空 shape 禁令：无 body-read 证据时只给 draft 命令，不生成 shape({})
  // 类型：body 用法推断（node.type === … → string()），无证据 any()
  if (code === DIAG.entryMayThrow && action.kind === "draft" && fn) {
    const bodyRead = input.suggestion?.match(/body-read\s*\{([^}]+)\}/)?.[1];
    const fieldNames = bodyRead
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // —— 证据发射面（数组接收者 / 成员读 / 参数本体标量）——
    // 多参逐位收窄：L2 残余可能来自任何未约束位（subtotal 的 tax 参与算术），
    // 只写一个参数的契约证不出 total。参数按声明序，无证据参数不发射。
    const contracts = collectParamContracts(source).get(fn);
    const entries = contracts ? [...contracts.entries()] : [];
    // —— 无证据回落：诊断 body-read 字段名 + any() 占位（不用武断 string()）。
    // 成员读/标量用法已由证据面覆盖；走到这里说明源码侧收集为空
    // （诊断仍带字段名），参数名未知 → 占位 arg
    let shapeText: string | undefined;
    let fallbackFields: BodyReadField[] | undefined;
    if (entries.length === 0) {
      if (fieldNames && fieldNames.length > 0) {
        fallbackFields = fieldNames.map((f) => ({
          field: f,
          type: "any()",
          via: "read (no type evidence)",
        }));
        shapeText = `arg: ${shapeDslFromFields(fallbackFields)}`;
      } else {
        // 空 shape 禁令：无任何证据时只给 draft 命令，不生成 shape({})
        return {
          titleKind: "fix",
          title: `${titlePrefix("fix")} Add sidecar param contract for ${fn} (via nudo contract --draft)`,
          edits: [],
          openPath: sidecarPath,
        };
      }
    } else {
      shapeText = entries.map(([p, ev]) => `${p}: ${contractDslOf(ev)}`).join(", ");
    }
    // DESIGN-003：身份=导出名 fn。绑定名不安全（保留字 / 非 ident）时别名
    // 发射（_nudo_<n> 按既有侧车内容避让），导出面保身份
    const direct = isJsBindingIdent(fn);
    // TS 侧车（`*.nudo.ts`）必须自带 builder import：裸 DSL 在 TS 下既缺
    // import（TS2304）又撞 TS 类型关键字（TS2693）⇒ 产物过不了 tsc
    // （Bug 546）。`.nudo.js` 侧车维持「裸注入」纪律，不加 import。
    const dsl = `fn({ ${shapeText} })`;
    const { importLine, dsl: dslOut } = isTsSidecar(sidecarPath)
      ? tsSidecarBuilderImport(dsl, sidecarText)
      : { importLine: undefined, dsl };
    const clause = direct
      ? `export const ${fn} = ${dslOut};\n`
      : (() => {
          const used = new Set(
            [...(sidecarText ?? "").matchAll(/(?<![\w$])_nudo_(\d+)(?![\w$])/g)].map(
              (x) => x[0]!,
            ),
          );
          const binding = allocNudoBinding((n) => used.has(n));
          return `const ${binding} = ${dslOut};\nexport { ${binding} as ${exportNameRepr(fn)} };\n`;
        })();
    const importPart = importLine ? `${importLine}\n` : "";
    const next =
      sidecarText && sidecarText.trim().length > 0
        ? sidecarText.endsWith("\n")
          ? sidecarText + importPart + clause
          : sidecarText + "\n" + importPart + clause
        : `// Generated by quickfix — review before accepting\n${importPart}${clause}`;
    // 验证门：合成侧车写盘后重分析，L2 未消 → 降级 [review] 不自动落盘。
    // 引擎证不出 total 时（回调体算术面不 total / any 字段被继续调用），
    // 半修复契约写盘只会把红诊断钉在侧车里。
    const cleared = sidecarClearsEntryThrow({
      file: input.file,
      source,
      sidecarPath,
      sidecarText: next,
      fn,
      ...(input.loadModule ? { loadModule: input.loadModule } : {}),
    });
    const summary =
      fallbackFields !== undefined
        ? fallbackFields.map((f) => `${f.field}: ${f.type}`).join(", ")
        : shapeText!;
    return {
      titleKind: cleared ? "fix" : "review",
      title: cleared
        ? `${titlePrefix("fix")} Add sidecar param contract for ${fn} (${summary})`
        : `${titlePrefix("review")} Add sidecar param contract for ${fn} (${summary}) — engine cannot prove total yet, review before applying`,
      edits: [],
      sidecar: { path: sidecarPath, newText: next },
      openPath: sidecarPath,
    };
  }

  // —— constraint-violated nullish → nullable(…) ——
  if (
    code === DIAG.constraintViolated &&
    (action.kind === "relax" || action.kind === "draft") &&
    fn &&
    sidecarText &&
    (/nullish/i.test(input.suggestion ?? "") || /nullish/i.test(input.expected ?? "") ||
      /use nullable/i.test(input.suggestion ?? ""))
  ) {
    const next = wrapReturnNullable(sidecarText, fn);
    if (next && next !== sidecarText) {
      // 验证门：合成侧车重分析——constraint-violated 与 entry-may-throw
      // 都得消失。Bug 556：旧改写把第三个实参（throws 义务）卷进
      // `nullable(...)` ⇒ 门禁换成 entry-may-throw（错误码都变了）⇒
      // 「修好了」是假的。⇒ 残留即降级 [review]，不自动落盘。
      const cleared = sidecarClearsConstraintViolation({
        file: input.file,
        source,
        sidecarPath,
        sidecarText: next,
        fn,
        ...(input.loadModule ? { loadModule: input.loadModule } : {}),
      });
      return {
        titleKind: cleared ? "fix" : "review",
        title: cleared
          ? `${titlePrefix("fix")} Wrap ${fn} return contract in nullable(…)`
          : `${titlePrefix("review")} Wrap ${fn} return contract in nullable(…) — engine cannot prove the fix, review before applying`,
        edits: [],
        sidecar: { path: sidecarPath, newText: next },
      };
    }
  }

  // —— unproven-return：relax（review，须看 diff）——
  if (code === DIAG.unprovenReturn && action.kind === "relax" && fn && sidecarText) {
    // 调用方（LSP）已有 relaxSidecarConstraint；这里给标题，edit 由调用方补
    return {
      titleKind: "review",
      title: `${titlePrefix("review")} Relax return contract for ${fn} to inferred surface`,
      edits: [],
      openPath: sidecarPath,
    };
  }

  // —— recursion-truncated：@nudo:budget ——
  // cycle 归因（#158）抬预算解不开（同抽象实参调用环），不提供该 quickfix
  if (code === DIAG.recursionTruncated && fn && input.reason !== "cycle") {
    const r = addBudgetAnnotation(source, fn);
    if (!r) return undefined;
    return {
      titleKind: "adjust",
      title: `${titlePrefix("adjust")} Add @nudo:budget forks=64 on ${fn}`,
      edits: r.edits,
    };
  }

  // —— unknown-inference / opaque-result：scaffold draft ——
  if (
    (code === DIAG.unknownInference || code === DIAG.opaqueResult) &&
    (action.kind === "mock" || action.kind === "draft")
  ) {
    return {
      titleKind: "scaffold",
      title: `${titlePrefix("scaffold")} ${action.label}`,
      edits: [],
      openPath: code === DIAG.opaqueResult ? input.file : sidecarPath,
    };
  }

  return undefined;
}
