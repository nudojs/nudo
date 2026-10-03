import type { Node, Comment, File } from "@babel/types";
import {
  type Abs,
  type MockHelper,
  type NudoConstraint,
  type Pred,
  stub,
  spy,
  mock,
  abs as makeAbs,
  numLit,
  strLit,
  boolLit,
  absFunction,
  joinAbs,
  execNudoModule,
  isNudoConstraint,
  constraintToEntryAbs,
  CONSTRAINT_BUILDER_NAMES,
  CONSTRAINT_EXPR_RE,
  SELF,
  listFnDirectiveScopes,
  parseEnvPayload,
  parseMockModulePayload,
  scanCaseArgSpans,
  scanCaseTags,
  extractBalancedParens,
} from "@nudojs/core";
// 字面量助手单源：core/internal 的 absLit（env/harvester/service 测试同源）
import { absLit } from "@nudojs/core/internal";
import { parse as babelParse } from "./parse.ts";

function absExact(shape: Abs["shape"]): Abs {
  return makeAbs(shape, undefined, undefined, "exact");
}

function absUnknown(): Abs {
  return makeAbs({ k: "unknown" }, undefined, undefined, "partial");
}

function absUnion(members: Abs[]): Abs {
  if (members.length === 0) return absExact({ k: "never" });
  return members.reduce((acc, m) => joinAbs(acc, m));
}

export type CaseDirective = {
  kind: "case";
  name: string;
  /** 无损参数 Abs（case 文法唯一真理源：约束构建器 / 具体字面量） */
  argsAbs: Abs[];
  /** `=> expected` 断言 Abs */
  expected?: Abs;
  commentLine?: number;
};

export type MockDirective = {
  kind: "mock";
  name: string;
  expression?: string;
  fromPath?: string;
  arrowFn?: { params: string[]; body: Node; paramPatterns: Node[] };
  sinonExpr?: SinonExpression;
  nudoMock?: MockHelper;
};

export type SinonExpression = {
  type: "stub" | "spy" | "mock";
  returnValue?: Abs;
  resolvedValue?: Abs;
  rejectedValue?: Abs;
};

export type PureDirective = {
  kind: "pure";
};

export type SkipDirective = {
  kind: "skip";
  returns?: Abs;
};

export type SampleDirective = {
  kind: "sample";
  count: number;
};

export type EnvDirective = {
  kind: "env";
  envs: string[];
};

export type MockModuleDirective = {
  kind: "mock-module";
  source: string;
  names?: string[];
  fromPath: string;
};

export type AsDirective = {
  kind: "as";
  typeAbs: Abs;
};

export type ReplaceDirective = {
  kind: "replace";
  targetSource: string;
  typeAbs: Abs;
};

export type InlineDirective = AsDirective | ReplaceDirective;

export type FileDirective = EnvDirective | MockModuleDirective;

export type Directive = CaseDirective | MockDirective | PureDirective | SkipDirective | SampleDirective;

export type FunctionWithDirectives = {
  node: Node;
  name: string;
  directives: Directive[];
};

// ---------------------------------------------------------------------------
// 指令文法诊断（单一通道：显式 sink）
//
// extractDirectives(ast, { diags }) / extractInlineDirectives(node, { diags })
// 传入调用方自备的累积数组——诊断同步落袋，单次调用内同文案去重。
// 不传 diags 的纯查询形态（等价 extractDirectivesQuiet）直接丢弃诊断。
// 需要把「extract 之后的再解析」（如 mock 种子对 @nudo:mock 表达式的
// parseCaseArgExpr 复解析）并入同一去重域的调用方，用
// runWithDirectiveDiags(diags, fn) 包住 extract + 再解析整段。
//
// 历史注记：曾有模块级 side-channel（全局缓冲 + directiveDiagCount()/
// takeDirectiveDiags(Since) 序号锚排干），两轮并发偷诊断事故（R2B-003：
// 全量 take 在 await 窗口偷走在途诊断）均源于该全局态，已删除。
//
// 非法/边界形态的 case、mock、as、skip 输入不再静默丢弃：发 nudo:directive-syntax
// 显式诊断。产品原则与侧车加载一致（refine.ts）：「执行失败/导出形式不识别
// 不再静默吞错」——文法层同等对待。
// ---------------------------------------------------------------------------

export type DirectiveDiag = { code: string; message: string };

/** 显式诊断通道的调用内状态：单次 extract / scope 内生效（含同文案去重） */
type DiagSinkState = { list: DirectiveDiag[]; seen: Set<string> };
let activeDiagSink: DiagSinkState | null = null;

/**
 * 在指定诊断数组上执行 fn：fn 内所有指令文法诊断（含不传 diags 的 extract
 * 与再解析路径，如 @nudo:mock 表达式的 parseCaseArgExpr 复解析）落袋并共用
 * 同一去重域——用于「extract + 复解析」必须共享 seen 的窗口（nudojs check
 * 的 D1 段）。fn 内显式传 diags 的 extract 自成新去重域。
 */
export function runWithDirectiveDiags<T>(diags: DirectiveDiag[], fn: () => T): T {
  const prev = activeDiagSink;
  activeDiagSink = { list: diags, seen: new Set() };
  try {
    return fn();
  } finally {
    activeDiagSink = prev;
  }
}

function emitDirectiveDiag(d: DirectiveDiag): void {
  // 无活动 sink 的纯查询路径：丢弃（hover/completion 等探测不得产诊断）
  if (!activeDiagSink) return;
  const key = `${d.code}\0${d.message}`;
  // seen 只在**单个 sink 域内**去重（同文件同文案不双报）。
  // 跨调用共享 seen 会同消息跨文件吞报（B 先 extract 后 A 丢报），也会让
  // 再次 extract 无法重新 emit（重分析饿死）。
  if (activeDiagSink.seen.has(key)) return;
  activeDiagSink.seen.add(key);
  activeDiagSink.list.push(d);
}

// 指令标签只在「注释行首」匹配（可选 `*` / `//` 已由 comment.value 剥掉）：
// 不得命中 case 参数字符串或文档散文里的 `@nudo:skip` / `@nudo:case` / `@nudo:mock` 字样。
// `\b` 防 `@nudo:skipped` / `@nudo:cases` 误命中。
/** 宽松捕获 @nudo:case 标签后的整行文本，用于检测非法名形态（含空标签）。
 * S4-004：`\s+` 跨行会把下一行粘进本标签（诊断错误归因/吞下一个标签），
 * 改同行分隔 `[ \t]`；`[^\n]*` 让空标签也可见。前缀镜像 core
 * directive-scan 的 CASE_NAME_REGEX（块 `*` 续行 / `///` 残留单 `/`）。 */
const CASE_TAG_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:case\b[ \t]*([^\n]*)/g;
/** JS 标识符（Unicode 感知）：mock 名文法 */
const JS_IDENT_RE = /^[\p{L}$_][\p{L}\p{N}$_]*$/u;
const MOCK_INLINE_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:mock\b[ \t]+([^\s=]+)[ \t]*=[ \t]*(.+)/g;
/** from 路径单/双引号皆可（`'./x.js'` 此前静默不识别）——`m[2] ?? m[3]` 取路径 */
const MOCK_FROM_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:mock\b[ \t]+([^\s]+)[ \t]+from[ \t]+(?:"([^"\n]+)"|'([^'\n]+)')/g;
/** 宽松捕获 @nudo:mock 标签后的整行文本（含空标签），用于检测非法名形态 */
const MOCK_TAG_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:mock\b[ \t]*([^\n]*)/g;
const PURE_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:pure\b/g;
const SKIP_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:skip\b(?:[ \t]+(\S[^\n]*))?/g;
/** 宽松捕获 @nudo:sample 后的整段 token（数字文法在下方校验，不再静默截断） */
const SAMPLE_REGEX = /(?:^|\n)[ \t]*(?:\*[ \t]*|\/[ \t]*)?@nudo:sample\b(?:[ \t]+(\S+))?/g;
/** 完整数字 token：整数 / 小数 / 负数 / 科学计数；禁止 `3.5` 截成 `3` */
const SAMPLE_NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 约束表达式（design-refine-derivation：case 实参主文法）。
 * 识别 `number()` / `number().gt(0)` / `lit(42)` / `union(…)` / `shape({…})` /
 * `array(…)` / `fn({…}, …)` / `any()` / `nullable(…)` / `partial` / `pick` / `omit` / `and` 等构建器。
 * 不匹配裸字面量 / 箭头函数；`T.*` 文法已删除。
 * 名单单源在 core 的 CONSTRAINT_BUILDERS；CONSTRAINT_EXPR_RE 由
 * CONSTRAINT_BUILDER_NAMES 生成，本文件不再手维护一份。
 */

/**
 * BUG-013：链式方法白名单（须与 core makeBuilder / ConstraintBuilder 同步）。
 * 约束表达式只允许这些方法出现在 `builder(...).method(...)` 链上。
 */
const TYPE_EXPR_CHAIN_METHODS = new Set([
  "gt", "ge", "lt", "le", "int", "min", "max", "length", "shift", "optional",
]);

/**
 * BUG-013：类型表达式 AST 白名单——进入 execNudoModule / new Function 前的门禁。
 * 仅允许：构建器名调用、白名单链式方法、字面量、Object/Array 字面量、
 * 一元负号数字、`undefined` 标识符。出现 AssignmentExpression /
 * SequenceExpression / 任意非白名单 CallExpression / 计算属性 / spread /
 * 可选链 / new / 模板串等一律拒绝。
 */
function isSafeTypeExprNode(node: Node): boolean {
  switch (node.type) {
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
      return true;
    case "Identifier":
      return node.name === "undefined";
    case "UnaryExpression":
      return node.operator === "-" && node.argument.type === "NumericLiteral";
    case "ArrayExpression":
      return node.elements.every(
        (el) => el !== null && el.type !== "SpreadElement" && isSafeTypeExprNode(el),
      );
    case "ObjectExpression":
      return node.properties.every((prop) => {
        if (prop.type !== "ObjectProperty") return false;
        if (prop.computed) return false;
        const key = prop.key;
        if (key.type !== "Identifier" && key.type !== "StringLiteral") return false;
        return isSafeTypeExprNode(prop.value);
      });
    case "CallExpression": {
      // Babel 8：可选链是独立的 OptionalCallExpression / OptionalMemberExpression
      // 节点，不进本分支（default 拒绝）。
      const argsOk = node.arguments.every(
        (arg) =>
          arg.type !== "SpreadElement" &&
          arg.type !== "ArgumentPlaceholder" &&
          isSafeTypeExprNode(arg),
      );
      if (!argsOk) return false;
      return isSafeTypeExprCallee(node.callee);
    }
    default:
      return false;
  }
}

function isSafeTypeExprCallee(node: Node): boolean {
  if (node.type === "Identifier") {
    return (CONSTRAINT_BUILDER_NAMES as readonly string[]).includes(node.name);
  }
  if (node.type === "MemberExpression") {
    if (node.computed) return false;
    if (node.property.type !== "Identifier") return false;
    if (!TYPE_EXPR_CHAIN_METHODS.has(node.property.name)) return false;
    return isSafeTypeExprNode(node.object);
  }
  return false;
}

/** 整条类型表达式过白名单。解析失败 / 多语句 / 非表达式根一律拒绝（fail-closed）。 */
function isSafeTypeExprSource(s: string): boolean {
  try {
    // 用 `(${s});` 包成单表达式语句：多语句拼接（`number()); process.exit(1); //`）
    // 会变成 body.length > 1，SequenceExpression 形态会被白名单拒绝。
    const ast = babelParse(`(${s});`);
    if (ast.program.body.length !== 1) return false;
    const stmt = ast.program.body[0];
    if (stmt.type !== "ExpressionStatement") return false;
    return isSafeTypeExprNode(stmt.expression);
  } catch {
    return false;
  }
}

/** 约束表达式 → NudoConstraint；非约束文法或执行失败 → undefined */
function tryParseConstraint(expr: string): NudoConstraint | undefined {
  const s = expr.trim();
  if (!CONSTRAINT_EXPR_RE.test(s)) return undefined;
  // BUG-013：CONSTRAINT_EXPR_RE 只是前缀预筛，不是安全门禁。进 new Function 前
  // 必须过 AST 白名单，否则 `number(), process.exit(1)` 可借前缀执行任意 JS。
  if (!isSafeTypeExprSource(s)) {
    emitDirectiveDiag({
      code: "nudo:directive-syntax",
      message: `Unsafe constraint expression rejected: ${s.slice(0, 80)} (only builder calls, chain methods, and literals are allowed)`,
    });
    return undefined;
  }
  try {
    // 受控执行：注入构建器，不碰用户 node_modules（与侧车同一路径）
    const src = `export const __nudo_case_arg = (${s});`;
    const exports = execNudoModule(src);
    const v = exports.__nudo_case_arg;
    if (!isNudoConstraint(v)) return undefined;
    return v;
  } catch {
    return undefined;
  }
}

function flattenPreds(preds: Pred[]): Pred[] {
  const out: Pred[] = [];
  const visit = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(visit);
      return;
    }
    out.push(p);
  };
  preds.forEach(visit);
  return out;
}

/** lit(42) 形态：唯一 eq(self, v)；非字面量 → undefined */
/** self-eq 字面量探测：用 found 区分「无 lit」与「lit 值 === undefined」 */
function constraintSelfEqLit(
  c: NudoConstraint,
  selfIds: string[],
): { found: true; value: import("@nudojs/core").LiteralValue } | { found: false } {
  const leaves = flattenPreds(c.preds);
  const eqs = leaves.filter((p) => p.op === "eq");
  if (eqs.length !== 1) return { found: false };
  const p = eqs[0]!;
  if (p.op !== "eq") return { found: false };
  const isSelf = (t: { op: string; id?: string }): boolean =>
    t.op === "var" && typeof t.id === "string" && selfIds.includes(t.id);
  const a = p.a;
  const b = p.b;
  if (isSelf(a) && b.op === "lit") return { found: true, value: b.value };
  if (isSelf(b) && a.op === "lit") return { found: true, value: a.value };
  return { found: false };
}

/**
 * case 实参约束 → Abs。lit 优先成字面量 Abs（term=lit，不是 var+eq）；
 * union 成员递归再拼 sum（同 prim 双 lit 不经 joinValues 急切塌缩）；
 * array/shape 递归展开 element/fields 以保留嵌套字面量身份；
 * 其余走 constraintToEntryAbs（var 项 + pred）。
 * 递归深度与 parseCaseArgExpr 同一上限（BUG-014：不靠 try/catch 兜栈溢出）。
 */
function constraintToCaseArgAbs(c: NudoConstraint, depth: number): Abs {
  if (depth > MAX_CASE_ARG_DEPTH) return depthCapDiag(constraintPreview(c));
  if (c.members && c.members.length > 0) {
    const parts = c.members.map((m) => constraintToCaseArgAbs(m, depth + 1));
    if (parts.length === 1) return parts[0]!;
    return { shape: { k: "sum", members: parts }, conf: "path" };
  }
  const selfIds = [SELF, "__arg", "__nudo_self__"];
  const litRes = constraintSelfEqLit(c, selfIds);
  if (litRes.found) {
    const lv = litRes.value;
    if (typeof lv === "number" && !Number.isNaN(lv)) return numLit(lv);
    if (typeof lv === "string") return strLit(lv);
    if (typeof lv === "boolean") return boolLit(lv);
    if (lv === null) return absLit(null);
    return absLit(undefined);
  }
  if (c.element) {
    return absExact({ k: "arr", element: constraintToCaseArgAbs(c.element, depth + 1) });
  }
  if (c.fields) {
    const slots: Record<string, { value: Abs }> = {};
    for (const [key, field] of Object.entries(c.fields)) {
      slots[key] = { value: constraintToCaseArgAbs(field.constraint, depth + 1) };
    }
    return absExact({ k: "obj", slots });
  }
  // 裸构建器（无 pred / 结构）：number()/string()/boolean() → 干净 prim；
  // any() → unknown。带 pred（number().gt(0)）仍走 entry Abs 以保留约束。
  // 注意：builder 上 int 是链式方法，不能用 !c.int 判断；只认数据标志 int === true。
  const bareScalar =
    !c.fields && !c.element && !c.members && !c.fn && c.int !== true && c.preds.length === 0;
  if (bareScalar) {
    if (c.prim === "number" || c.prim === "string" || c.prim === "boolean") {
      return absExact({ k: "prim", type: c.prim });
    }
    if (!c.prim) return absUnknown();
  }
  return constraintToEntryAbs(c, "__arg");
}

/**
 * BUG-014：case 实参结构递归深度上限。`[`×5000 一类超深嵌套曾以
 * RangeError 打穿 extractDirectives（宿主进程崩溃）——文法边界走
 * nudo:directive-syntax 诊断 + unknown 折叠，不把宿主栈深当隐式限制。
 * 合法用例（测试/文档所见最深 ~4 层）远低于 32。
 */
const MAX_CASE_ARG_DEPTH = 32;

/** 深度超限统一诊断：截断预览，防止恶意超长实参借诊断报文膨胀缓冲 */
function depthCapDiag(expr: string): Abs {
  emitDirectiveDiag({
    code: "nudo:directive-syntax",
    message: `Type expression nesting exceeds depth ${MAX_CASE_ARG_DEPTH}: ${expr.trim().slice(0, 40)} … (deeper structure collapses to unknown)`,
  });
  return absUnknown();
}

/** 约束树无原文可引：只标注形态（不再递归展开，否则又是一条无界递归） */
function constraintPreview(c: NudoConstraint): string {
  if (c.element) return "array(…)";
  if (c.members) return "union(…)";
  if (c.fields) return "shape({ … })";
  if (c.fn) return "fn(…)";
  return c.prim ? `${c.prim}()` : "constraint";
}

/**
 * case 实参 / 指令类型表达式唯一文法：约束构建器优先，其余为具体字面量、
 * 结构字面量与箭头函数。`T.*` 文法已物理删除。
 * depth 按包含关系逐层 +1 线程化传递（兄弟共享父深度，不用共享可变计数器）。
 */
export function parseCaseArgExpr(expr: string, depth = 0): Abs {
  if (depth > MAX_CASE_ARG_DEPTH) return depthCapDiag(expr);
  const constraint = tryParseConstraint(expr);
  if (constraint) {
    try {
      return constraintToCaseArgAbs(constraint, depth);
    } catch {
      return absUnknown();
    }
  }
  return parseLiteralOrStructure(expr, depth);
}

/** 具体字面量 / 对象数组字面量 / 箭头函数 → Abs；无法识别 → unknown */
function parseLiteralOrStructure(expr: string, depth: number): Abs {
  const s = expr.trim();

  if (s === "true") return absLit(true);
  if (s === "false") return absLit(false);
  if (s === "null") return absLit(null);
  if (s === "undefined") return absLit(undefined);
  if (s === "unknown" || s === "any") return absUnknown();
  if (s === "never") return absExact({ k: "never" });

  // Function literals: (x) => expr, x => expr, (x, y) => expr, function(x) { ... }
  if (findTopLevelArrow(s) !== -1 || /^function\s*[\w$]*\s*\(/.test(s)) {
    const fnExpr = parseArrowFunctionExpr(s);
    if (fnExpr) {
      return absFunction(fnExpr.params, { body: fnExpr.body });
    }
  }

  if (/^-?\d+(\.\d+)?$/.test(s)) return absLit(Number(s));

  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return absLit(s.slice(1, -1));
  }

  if (s.startsWith("{") && s.endsWith("}")) {
    return parseObjectLiteral(s.slice(1, -1).trim(), depth);
  }

  if (s.startsWith("[") && s.endsWith("]")) {
    const content = s.slice(1, -1).trim();
    if (!content) return absExact({ k: "tuple", elements: [] });
    const elements = splitTopLevelArgs(content);
    return absExact({
      k: "tuple",
      elements: elements.map((e) => parseCaseArgExpr(e, depth + 1)),
    });
  }

  // `T.*` 及其它未知标识符：明确不再解析
  return absUnknown();
}

function parseObjectLiteral(content: string, depth: number): Abs {
  if (!content) return absExact({ k: "obj", slots: {} });
  const entries = splitTopLevelArgs(content);
  const slots: Record<string, { value: Abs }> = {};
  for (const entry of entries) {
    const colonIdx = findTopLevelColon(entry);
    if (colonIdx === -1) continue;
    const key = entry.slice(0, colonIdx).trim().replace(/^["']|["']$/g, "");
    const val = entry.slice(colonIdx + 1).trim();
    slots[key] = { value: parseCaseArgExpr(val, depth + 1) };
  }
  return absExact({ k: "obj", slots });
}

function parsePrimitiveValue(s: string): string | number | boolean | null | undefined {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (s === "undefined") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * 字符串感知的括号深度扫描：引号内字符不当结构（与 findReplaceSeparator 同口径）。
 * 与 parseCaseArgExpr 的**原样 slice**（不反转义）一致：引号内 `\` 不是转义
 * ——`"foo\"` 的值是 `foo\`，引号正常闭合。此前把 `\` 当转义会吃掉闭合引号，
 * 整条 case 被静默丢弃。
 * onChar 对每个可见字符（含字符串内容）回调；onStructural 仅对非字符串字符回调。
 */
function scanWithStrings(
  s: string,
  onChar: (ch: string, i: number) => void,
  onStructural: (ch: string, i: number, depth: number) => void,
): void {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      onChar(ch, i);
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      onChar(ch, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      onChar(ch, i);
      onStructural(ch, i, depth);
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      onChar(ch, i);
      onStructural(ch, i, depth);
      continue;
    }
    onChar(ch, i);
    onStructural(ch, i, depth);
  }
}

function splitTopLevelArgs(s: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      current += ch;
      // 原样 slice：`\` 不是转义（与 parseCaseArgExpr 一致）
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function findTopLevelColon(s: string): number {
  let found = -1;
  scanWithStrings(
    s,
    () => {},
    (ch, i, depth) => {
      if (found === -1 && ch === ":" && depth === 0) found = i;
    },
  );
  return found;
}

function findTopLevelArrow(s: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length - 1; i++) {
    const ch = s[i]!;
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && ch === "=" && s[i + 1] === ">") return i;
  }
  return -1;
}

function parseArrowFunctionExpr(expr: string): { params: string[]; body: Node; paramPatterns: Node[] } | null {
  // Try to parse as an arrow function expression
  try {
    // Wrap in a variable declaration to make it a valid statement
    const wrapped = `const __mock = ${expr};`;
    const ast = babelParse(wrapped);

    const decl = ast.program.body[0];
    if (decl.type !== "VariableDeclaration") return null;

    const init = decl.declarations[0]?.init;
    if (!init || (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression")) {
      return null;
    }

    const params: string[] = [];
    const paramPatterns: Node[] = [];
    for (let i = 0; i < init.params.length; i++) {
      const param = init.params[i];
      if (param.type === "Identifier") {
        params.push(param.name);
        paramPatterns.push(param);
      } else if (param.type === "RestElement" && param.argument.type === "Identifier") {
        // Handle rest parameters: (...args) => ...
        params.push(`...${param.argument.name}`);
        paramPatterns.push(param);
      } else if (param.type === "ArrayPattern" || param.type === "ObjectPattern") {
        // Handle destructuring patterns: ([a, b]) => ... or ({x, y}) => ...
        params.push(`__destructured_${i}`);
        paramPatterns.push(param);
      }
    }

    return { params, body: init.body, paramPatterns };
  } catch {
    return null;
  }
}

/** 显式 unknown 形态：`unknown` / `any` / `any()`——合法的 unknown，不是解析失败 */
function isExplicitUnknownExpr(expr: string): boolean {
  const s = expr.trim();
  return s === "unknown" || s === "any" || s === "any()";
}

/** 实参/期望/mock 返回值文法 → Abs（约束构建器 / 具体字面量） */
function parseAbsExpr(expr: string): Abs {
  return parseCaseArgExpr(expr);
}

/**
 * 解析表达式并在静默 fallback 到 unknown 时发诊断（I2）。
 * 显式 `unknown`/`any`/`any()` 不算 fallback；`T.*` 等不可识别形态发 nudo:directive-syntax。
 */
function parseAbsExprDiag(expr: string, context: string): Abs {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k === "unknown" && !abs.term && !isExplicitUnknownExpr(expr)) {
    emitDirectiveDiag({
      code: "nudo:directive-syntax",
      message: `Unrecognized type expression in ${context}: ${expr.trim()} (use constraint builders, literals, or structure syntax)`,
    });
  }
  return abs;
}

/**
 * `@nudo:skip` 返回类型显式文法（D1=A1 产品文法变更）：
 *   `@nudo:skip`              → returns = null（不声明）
 *   `@nudo:skip => <expr>`    → 显式类型（箭头前缀）
 *   `@nudo:skip (<expr>)`     → 显式类型（括号包裹，整段包完才算）
 *   `@nudo:skip <散文>`       → returns = null（散文不得当类型表达式）
 */
function parseSkipReturnsExpr(rest: string | undefined): Abs | undefined {
  if (rest === undefined) return undefined;
  const s = rest.trim();
  if (s === "") return undefined;

  // `=> <expr>` 显式类型
  if (s.startsWith("=>")) {
    const expr = s.slice(2).trim();
    if (expr === "") {
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: `@nudo:skip => requires a type expression (e.g. @nudo:skip => number())`,
      });
      return undefined;
    }
    return parseAbsExprDiag(expr, "@nudo:skip =>");
  }

  // `(<expr>)` 显式类型：外层括号必须包完整段
  if (s.startsWith("(")) {
    const inner = extractBalancedParens(s, 0);
    if (inner !== null && s.slice(inner.length + 2).trim() === "") {
      return parseAbsExprDiag(inner, "@nudo:skip (...)");
    }
    if (inner === null) {
      // S4-003 同族：`@nudo:skip (number()` 括号未闭合不再静默落回散文分支
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: `@nudo:skip type expression has unclosed parenthesis (expected @nudo:skip (<typeExpr>)) — got: ${s.slice(0, 60)}`,
      });
      return undefined;
    }
    // 括号后有残留：不按显式类型处理，落到散文分支
  }

  // 散文：不解析为类型，returns = null
  return undefined;
}

function parseSinonExpr(expr: string): SinonExpression | null {
  const s = expr.trim();

  // Match sinon.stub().returns(value)
  const stubReturnsMatch = s.match(/^sinon\.stub\(\)\.returns\((.+)\)$/);
  if (stubReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(stubReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().resolves(value)
  const stubResolvesMatch = s.match(/^sinon\.stub\(\)\.resolves\((.+)\)$/);
  if (stubResolvesMatch) {
    return {
      type: "stub",
      resolvedValue: parseAbsExpr(stubResolvesMatch[1].trim()),
    };
  }

  // Match sinon.stub().rejects(value)
  const stubRejectsMatch = s.match(/^sinon\.stub\(\)\.rejects\((.+)\)$/);
  if (stubRejectsMatch) {
    return {
      type: "stub",
      rejectedValue: parseAbsExpr(stubRejectsMatch[1].trim()),
    };
  }

  // Match sinon.stub().onFirstCall().returns(value)
  const onFirstCallReturnsMatch = s.match(/^sinon\.stub\(\)\.onFirstCall\(\)\.returns\((.+)\)$/);
  if (onFirstCallReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(onFirstCallReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().onSecondCall().returns(value)
  const onSecondCallReturnsMatch = s.match(/^sinon\.stub\(\)\.onSecondCall\(\)\.returns\((.+)\)$/);
  if (onSecondCallReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(onSecondCallReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().onThirdCall().returns(value)
  const onThirdCallReturnsMatch = s.match(/^sinon\.stub\(\)\.onThirdCall\(\)\.returns\((.+)\)$/);
  if (onThirdCallReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(onThirdCallReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().onCall(n).returns(value)
  const onCallReturnsMatch = s.match(/^sinon\.stub\(\)\.onCall\(\d+\)\.returns\((.+)\)$/);
  if (onCallReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(onCallReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().withArgs(args).returns(value)
  const withArgsReturnsMatch = s.match(/^sinon\.stub\(\)\.withArgs\(.+\)\.returns\((.+)\)$/);
  if (withArgsReturnsMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(withArgsReturnsMatch[1].trim()),
    };
  }

  // Match sinon.stub().callsFake(fn)
  const callsFakeMatch = s.match(/^sinon\.stub\(\)\.callsFake\((.+)\)$/);
  if (callsFakeMatch) {
    // For callsFake, we try to parse the function as an arrow function
    const arrowFn = parseArrowFunctionExpr(callsFakeMatch[1].trim());
    if (arrowFn) {
      return {
        type: "stub",
        returnValue: absFunction(arrowFn.params, {
          body: arrowFn.body,
        }),
      };
    }
    return { type: "stub" };
  }

  // Match sinon.stub().returns(value).onFirstCall().returns(otherValue)
  // This is a complex chain - we'll just use the first .returns() value
  const complexChainMatch = s.match(/^sinon\.stub\(\)\.returns\((.+)\)\./);
  if (complexChainMatch) {
    return {
      type: "stub",
      returnValue: parseAbsExpr(complexChainMatch[1].trim()),
    };
  }

  // Match sinon.stub() (no chaining)
  if (s === "sinon.stub()") {
    return { type: "stub" };
  }

  // Match sinon.spy()
  if (s === "sinon.spy()") {
    return { type: "spy" };
  }

  // Match sinon.mock()
  if (s === "sinon.mock()") {
    return { type: "mock" };
  }

  return null;
}

function parseNudoMockExpr(expr: string): MockHelper | null {
  // BUG-014 同族：sinon 前缀剥离改迭代。原尾递归对 `sinon.`×N 实参每层一帧，
  // 恶意超长前缀以 RangeError 打穿 extractDirectives。顶部一次性剥净等价：
  // 下方所有分支锚定 `^stub\(` / `^spy\(` / `^mock\(` 或精确匹配，无一能匹配
  // `sinon.` 开头的串，先剥后试与逐层剥试结果一致。
  let s = expr.trim();
  while (s.startsWith("sinon.")) s = s.slice("sinon.".length);

  // Match stub().returns(value).onFirstCall()
  const stubReturnsOnFirstMatch = s.match(/^stub\(\)\.returns\((.+)\)\.onFirstCall\(\)$/);
  if (stubReturnsOnFirstMatch) {
    const helper = stub.returns(parseAbsExpr(stubReturnsOnFirstMatch[1].trim()));
    helper.onFirstCallValue = helper.returnValue;
    return helper;
  }

  // Match stub().returns(value).onSecondCall()
  const stubReturnsOnSecondMatch = s.match(/^stub\(\)\.returns\((.+)\)\.onSecondCall\(\)$/);
  if (stubReturnsOnSecondMatch) {
    return stub.returns(parseAbsExpr(stubReturnsOnSecondMatch[1].trim()));
  }

  // Match stub().returns(value).onCall(n)
  const stubReturnsOnCallMatch = s.match(/^stub\(\)\.returns\((.+)\)\.onCall\(\d+\)$/);
  if (stubReturnsOnCallMatch) {
    return stub.returns(parseAbsExpr(stubReturnsOnCallMatch[1].trim()));
  }

  // Match stub().callsFake((args) => body)
  const stubCallsFakeMatch = s.match(/^stub\(\)\.callsFake\((.+)\)$/);
  if (stubCallsFakeMatch) {
    const arrowFn = parseArrowFunctionExpr(stubCallsFakeMatch[1].trim());
    if (arrowFn) {
      return stub.callsFake({ params: arrowFn.params, body: arrowFn.body, async: false });
    }
    return { kind: "mock-helper" };
  }

  // Match stub().withArgs(args).returns(value)
  const stubWithArgsMatch = s.match(/^stub\(\)\.withArgs\((.+)\)\.returns\((.+)\)$/);
  if (stubWithArgsMatch) {
    const retVal = parseAbsExpr(stubWithArgsMatch[2].trim());
    const argsStr = stubWithArgsMatch[1].trim();
    const args = splitTopLevelArgs(argsStr).map((a) => parseAbsExpr(a));
    // 返回值只挂在 withArgs 分支上（sinon 语义：实参匹配才返回），不设全局
    // returnValue —— 否则未命中调用会错误复用链返回值
    const helper: MockHelper = { kind: "mock-helper" };
    helper.withArgsCases = [{ args, returnValue: retVal }];
    return helper;
  }

  // Match stub().onFirstCall().returns(value) —— 链在 returns 上取值
  const stubOnFirstReturnsMatch = s.match(/^stub\(\)\.onFirstCall\(\)\.returns\((.+)\)$/);
  if (stubOnFirstReturnsMatch) {
    return stub.returns(parseAbsExpr(stubOnFirstReturnsMatch[1].trim()));
  }

  // Match stub().onFirstCall(value) —— 无 returnValue 时 Abs 作默认返回
  // [^()]* 避免把 onFirstCall().returns(...) 的尾链吞进实参
  const stubOnFirstValueMatch = s.match(/^stub\(\)\.onFirstCall\(([^()]*)\)$/);
  if (stubOnFirstValueMatch && stubOnFirstValueMatch[1].trim() !== "") {
    const helper: MockHelper = { kind: "mock-helper" };
    helper.onFirstCallValue = parseAbsExpr(stubOnFirstValueMatch[1].trim());
    return helper;
  }

  // Match spy().returns(value)
  const spyReturnsMatch = s.match(/^spy\(\)\.returns\((.+)\)$/);
  if (spyReturnsMatch) {
    return spy.returns(parseAbsExpr(spyReturnsMatch[1].trim()));
  }

  // Match stub().resolves(value).onFirstCall()
  const stubResolvesOnFirstMatch = s.match(/^stub\(\)\.resolves\((.+)\)\.onFirstCall\(\)$/);
  if (stubResolvesOnFirstMatch) {
    return stub.resolves(parseAbsExpr(stubResolvesOnFirstMatch[1].trim()));
  }

  // Match stub().returns(value)
  const stubReturnsMatch = s.match(/^stub\(\)\.returns\((.+)\)$/);
  if (stubReturnsMatch) {
    return stub.returns(parseAbsExpr(stubReturnsMatch[1].trim()));
  }

  // Match stub().resolves(value)
  const stubResolvesMatch = s.match(/^stub\(\)\.resolves\((.+)\)$/);
  if (stubResolvesMatch) {
    return stub.resolves(parseAbsExpr(stubResolvesMatch[1].trim()));
  }

  // Match stub().rejects(value)
  const stubRejectsMatch = s.match(/^stub\(\)\.rejects\((.+)\)$/);
  if (stubRejectsMatch) {
    return stub.rejects(parseAbsExpr(stubRejectsMatch[1].trim()));
  }

  // Match stub()
  if (s === "stub()") {
    return stub();
  }

  // Match spy()
  if (s === "spy()") {
    return spy();
  }

  // Match mock()
  if (s === "mock()") {
    return mock();
  }

  return null;
}

function parseDirectivesFromComments(comments: readonly Comment[]): Directive[] {
  return parseDirectivesFromCommentTexts(
    comments.map((c) => ({
      text: c.value,
      startLine: c.loc?.start.line ?? 0,
    })),
  );
}

/**
 * 从注释块文本抽函数级指令（case/mock/pure/skip/sample）。
 * D6=G2：文本来自 core directive-scan 的 scope 绑定，与 contract 同一函数集合。
 */
function parseDirectivesFromCommentTexts(
  comments: Array<{ text: string; startLine: number }>,
): Directive[] {
  const directives: Directive[] = [];
  for (const { text, startLine: commentStartLine } of comments) {

    // D5=F1：case 标签文法（平衡括号 / 多行实参 / => expected / 实参遮罩）在
    // core directive-scan 单源。多行实参里的 `@nudo:*` 字样是数据不是指令——
    // PURE/SKIP/MOCK/SAMPLE 扫描前必须按实参区间遮罩。
    const caseArgSpans: [number, number][] = scanCaseArgSpans(text);
    const caseTags = scanCaseTags(text);

    // case 名非法形态（单引号/空/转义/缺实参括号）→ nudo:directive-syntax
    scanMalformedCaseNames(text, caseArgSpans);

    const inCaseArgs = (idx: number): boolean =>
      caseArgSpans.some(([s, e]: [number, number]) => idx >= s && idx < e);

    // mock 名非法形态（非标识符）→ nudo:directive-syntax
    scanMalformedMockNames(text, caseArgSpans);

    MOCK_FROM_REGEX.lastIndex = 0;
    let mockFromMatch: RegExpExecArray | null;
    const mockFromRanges: [number, number][] = [];
    while ((mockFromMatch = MOCK_FROM_REGEX.exec(text)) !== null) {
      if (inCaseArgs(mockFromMatch.index)) continue;
      const name = mockFromMatch[1]!;
      if (!JS_IDENT_RE.test(name)) continue; // 已由 scanMalformedMockNames 报诊断
      directives.push({
        kind: "mock",
        name,
        fromPath: mockFromMatch[2] ?? mockFromMatch[3],
      });
      mockFromRanges.push([mockFromMatch.index, mockFromMatch.index + mockFromMatch[0].length]);
    }

    MOCK_INLINE_REGEX.lastIndex = 0;
    let mockMatch: RegExpExecArray | null;
    while ((mockMatch = MOCK_INLINE_REGEX.exec(text)) !== null) {
      const inFromRange = mockFromRanges.some(
        ([s, e]) => mockMatch!.index >= s && mockMatch!.index < e,
      );
      if (inFromRange || inCaseArgs(mockMatch.index)) continue;

      const mockName = mockMatch[1]!;
      if (!JS_IDENT_RE.test(mockName)) continue; // 已由 scanMalformedMockNames 报诊断

      const expr = mockMatch[2].trim();
      let arrowFn = parseArrowFunctionExpr(expr);
      const sinonExpr = parseSinonExpr(expr);
      const nudoMock = parseNudoMockExpr(expr);

      // callsFake 统一：sinon.stub().callsFake(fn) / stub().callsFake(fn) 都把
      // fn 提升到 arrowFn 字段——与 @nudo:mock f = (x) => ... 走完全同一绑定机制
      // （applyMocks 的 T.fn + _paramPatterns + 全局 env 闭包），调用时以实参求值
      if (!arrowFn) {
        const callsFakeChain = expr.match(/^(?:sinon\.)?stub\(\)\.callsFake\((.+)\)$/);
        if (callsFakeChain) {
          arrowFn = parseArrowFunctionExpr(callsFakeChain[1].trim());
        }
      }

      directives.push({
        kind: "mock",
        name: mockName,
        expression: expr,
        arrowFn: arrowFn ?? undefined,
        sinonExpr: sinonExpr ?? undefined,
        nudoMock: nudoMock ?? undefined,
      });
    }

    for (const tag of caseTags) {
      const name = tag.name;
      // 块注释续行的 ` * ` 前缀不属于实参文本（键名会被污染成 "* supplyChain"）
      const cleaned = tag.argsText
        .split("\n")
        .map((line) => line.replace(/^\s*\*\s?/, ""))
        .join("\n");
      const rawArgs = splitTopLevelArgs(cleaned);
      const argsAbs = rawArgs.map((a) => parseAbsExprDiag(a, `@nudo:case "${name}" argument`));

      const expected =
        tag.expectedText !== undefined
          ? parseAbsExprDiag(tag.expectedText, `@nudo:case "${name}" => expected`)
          : undefined;

      // tagOffset 可能落在行首前缀（`\n * `）上；commentLine 按标签实际位置计行
      const linesBeforeMatch = text.slice(0, tag.tagOffset).split("\n").length - 1;
      const commentLine = commentStartLine + linesBeforeMatch;

      directives.push({
        kind: "case",
        name,
        argsAbs,
        expected,
        commentLine,
      });
    }

    PURE_REGEX.lastIndex = 0;
    let pureMatch: RegExpExecArray | null;
    while ((pureMatch = PURE_REGEX.exec(text)) !== null) {
      if (inCaseArgs(pureMatch.index)) continue;
      directives.push({ kind: "pure" });
      break;
    }

    SKIP_REGEX.lastIndex = 0;
    let skipMatch: RegExpExecArray | null;
    while ((skipMatch = SKIP_REGEX.exec(text)) !== null) {
      if (inCaseArgs(skipMatch.index)) continue;
      // D1=A1：散文不得当类型表达式；类型须 `=>` 或括号显式形式
      const returns = parseSkipReturnsExpr(skipMatch[1]);
      directives.push({
        kind: "skip",
        returns,
      });
    }

    SAMPLE_REGEX.lastIndex = 0;
    let sampleMatch: RegExpExecArray | null;
    while ((sampleMatch = SAMPLE_REGEX.exec(text)) !== null) {
      if (inCaseArgs(sampleMatch.index)) continue;
      const raw = sampleMatch[1];
      // 无数字 / 非完整数字 token：显式 nudo:directive-syntax，不再静默忽略或截断
      if (raw === undefined || !SAMPLE_NUM_RE.test(raw)) {
        emitDirectiveDiag({
          code: "nudo:directive-syntax",
          message: `Malformed @nudo:sample: expected a numeric count (integer, decimal, or negative) — got: @nudo:sample ${raw ?? "(missing count)"}`,
        });
        continue;
      }
      directives.push({ kind: "sample", count: Number(raw) });
    }
  }
  return directives;
}

/**
 * 检测非法 case 名形态（F-3 #1-3）：单引号名、空名、名内转义引号、缺实参括号。
 * 合法形态 `@nudo:case "name" (…)` 已由 CASE_NAME_REGEX 吸走；这里扫剩下的标签。
 */
function scanMalformedCaseNames(text: string, caseArgSpans: [number, number][]): void {
  const inCaseArgs = (idx: number): boolean =>
    caseArgSpans.some(([s, e]) => idx >= s && idx < e);
  CASE_TAG_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CASE_TAG_REGEX.exec(text)) !== null) {
    if (inCaseArgs(m.index)) continue;
    const rest = m[1]!.trim();
    // 合法形态前缀：非空双引号名 + 同行实参括号（已被 CASE_NAME_REGEX 吸走的不重复报）
    const legal = rest.match(/^("[^"]+")[ \t]*\(/);
    if (legal) {
      // S4-003：合法形态判定必须真的平衡——此前 `"a" (1`（未闭合）既有形似
      // 前缀又不进 caseArgSpans，被静默丢弃且零诊断。跨行未闭合同样在此暴露。
      const parenIdx = m.index + m[0].length - m[1]!.length + legal[0].length - 1;
      if (extractBalancedParens(text, parenIdx) === null) {
        emitDirectiveDiag({
          code: "nudo:directive-syntax",
          message: `Malformed @nudo:case: unclosed argument list (missing closing ")") — got: @nudo:case ${rest.slice(0, 60)}`,
        });
      }
      continue;
    }
    let reason: string;
    if (rest.startsWith("'")) {
      reason = `single-quoted name (use double quotes: @nudo:case "name" (…))`;
    } else if (rest.startsWith('""')) {
      reason = `empty name (name must be non-empty)`;
    } else if (/^"[^"]*\\/.test(rest)) {
      reason = `escaped quote in name (avoid embedded double quotes)`;
    } else if (rest.startsWith('"')) {
      reason = `malformed name or missing argument list (expected @nudo:case "name" (…))`;
    } else {
      reason = `missing quoted name (expected @nudo:case "name" (…))`;
    }
    emitDirectiveDiag({
      code: "nudo:directive-syntax",
      message: `Malformed @nudo:case: ${reason} — got: @nudo:case ${rest.slice(0, 60)}`,
    });
  }
}

/**
 * 检测非法 mock 名形态（F-3 #4）：非 JS 标识符。
 * `变量` / `café` 等 Unicode 标识符合法；`foo-bar` / `123abc` 等发诊断。
 */
function scanMalformedMockNames(text: string, caseArgSpans: [number, number][]): void {
  const inCaseArgs = (idx: number): boolean =>
    caseArgSpans.some(([s, e]) => idx >= s && idx < e);
  MOCK_TAG_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MOCK_TAG_REGEX.exec(text)) !== null) {
    if (inCaseArgs(m.index)) continue;
    const rest = m[1]!.trim();
    // 提取名部分：到 `=` 或 `from` 之前
    const nameMatch = rest.match(/^([^\s=]+)(?:\s*=|\s+from\b)/);
    if (!nameMatch) {
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: `Malformed @nudo:mock: cannot parse name (expected @nudo:mock <ident> = <expr> or @nudo:mock <ident> from "path" / 'path') — got: ${rest.slice(0, 60)}`,
      });
      continue;
    }
    const name = nameMatch[1]!;
    if (!JS_IDENT_RE.test(name)) {
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: `Malformed @nudo:mock name '${name}': not a valid identifier (use letters, digits, _, $; Unicode letters allowed)`,
      });
      continue;
    }
    // S4-004 同族：from 路径必须同行闭引号——此前 `"([^"]+)` 跨行把下一行
    // 粘进 fromPath（错误归因）；收紧后引号未闭合不再静默丢弃。
    // 单/双引号独立判闭（`"a'` / `'a"` 都算未闭合）
    const afterName = rest.slice(name.length);
    if (/^[ \t]+from[ \t]+(?:"[^"\n]*|'[^'\n]*)$/.test(afterName)) {
      emitDirectiveDiag({
        code: "nudo:directive-syntax",
        message: `Malformed @nudo:mock from: unclosed quote in path (expected @nudo:mock ${name} from "path" / 'path') — got: @nudo:mock ${rest.slice(0, 60)}`,
      });
    }
  }
}

function getFunctionName(node: Node): string {
  if (node.type === "FunctionDeclaration" && node.id) return node.id.name;
  if (node.type === "ExportNamedDeclaration") {
    // export const f = … / export function f …
    return node.declaration ? getFunctionName(node.declaration as Node) : "<anonymous>";
  }
  if (node.type === "ExportDefaultDeclaration" && node.declaration.type === "FunctionDeclaration" && node.declaration.id) {
    return node.declaration.id.name;
  }
  if (node.type === "VariableDeclaration") {
    const decl = node.declarations[0];
    if (decl.id.type === "Identifier") return decl.id.name;
  }
  return "<anonymous>";
}

/**
 * extractDirectives 显式诊断通道 opts。
 *
 * `diags`：调用方自备的诊断累积数组——本次 extract 产生的指令文法诊断
 * 全部同步落袋，单次调用内同文案去重。不传时为纯查询形态：诊断丢弃
 * （等价 extractDirectivesQuiet）；若外层有 runWithDirectiveDiags 活动域，
 * 则落入该域并与其共享去重。
 */
export type ExtractDirectivesOpts = {
  diags?: DirectiveDiag[];
};

/**
 * D6=G2：指令绑定 AST 最近 Function（含 nested function、class method）。
 * 作用域清单与 refine 的 @nudo:contract 同源（core directive-scan），
 * case 与 contract 对同一函数集合同时可见。
 */
export function extractDirectives(
  ast: Node,
  opts?: ExtractDirectivesOpts,
): FunctionWithDirectives[] {
  // 不传 diags：不自成去重域——落外层 runWithDirectiveDiags 域（无则丢弃）
  if (!opts?.diags) return collectFnDirectives(ast);
  // 显式通道：sink 态仅在本次调用内生效（finally 恢复，异常不泄漏）
  const prev = activeDiagSink;
  activeDiagSink = { list: opts.diags, seen: new Set() };
  try {
    return collectFnDirectives(ast);
  } finally {
    activeDiagSink = prev;
  }
}

function collectFnDirectives(ast: Node): FunctionWithDirectives[] {
  const results: FunctionWithDirectives[] = [];
  if (ast.type !== "File") return results;

  const scopes = listFnDirectiveScopes(ast as File);
  for (const scope of scopes) {
    const directives = parseDirectivesFromCommentTexts(
      scope.commentTexts.map((text, i) => ({
        text,
        startLine: scope.commentStartLines[i] ?? 0,
      })),
    );
    if (directives.length === 0) continue;
    results.push({ node: scope.node, name: scope.name, directives });
  }
  return results;
}

/**
 * 纯查询 extract：诊断丢弃——hover/completion/collectSkipReturns 等探测
 * 路径不产诊断（不污染消费方待收的诊断，也不背走别人的在途诊断）。
 * 需要诊断的调用方用 extractDirectives(ast, { diags })。
 */
export function extractDirectivesQuiet(ast: Node): FunctionWithDirectives[] {
  return extractDirectives(ast, { diags: [] });
}

/**
 * S4-006：行内指令行前缀剥离——镜像 core cleanDirectiveLine（块注释 `* ` 续行 /
 * 行注释 `///` 残留的单个 `/`）。此前 `^\s*@nudo:as` 对 JSDoc 块整体匹配，
 * `*` 前缀挡在标签前导致整条静默丢失。
 */
function stripInlineCommentPrefix(line: string, kind: "line" | "block"): string {
  const s = kind === "block" ? line.replace(/^\s*\*\s?/, "") : line.replace(/^\//, "");
  return s.trim();
}

const AS_LINE_REGEX = /^@nudo:as[ \t]+(.+)$/;
const REPLACE_LINE_REGEX = /^@nudo:replace[ \t]+(.+)$/;
const AS_BARE_RE = /^@nudo:as[ \t]*$/;
const REPLACE_BARE_RE = /^@nudo:replace[ \t]*$/;

/**
 * S4-006 同族：尾注释探测改字符串感知——`lit("a /* b")` 里的 `//` / `/*`
 * 不再误判为尾注释（与 scanWithStrings 同口径：`\` 不是转义）。
 * 返回尾注释起点下标；无 → -1。
 */
function findTrailingCommentStart(expr: string): number {
  let inString: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]!;
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if ((ch === " " || ch === "\t") && /^[ \t]+(?:\/\/|\/\*)/.test(expr.slice(i))) {
      return i;
    }
  }
  return -1;
}

/**
 * 行内指令（@nudo:as / @nudo:replace）抽取，源为节点的 leadingComments。
 * 诊断通道与 extractDirectives 同形：传 opts.diags 落调用方数组（单次调用
 * 内同文案去重，语句级调用各自独立去重）；不传则落外层
 * runWithDirectiveDiags 域（无则丢弃，纯查询形态）。
 */
export function extractInlineDirectives(
  node: Node,
  opts?: ExtractDirectivesOpts,
): InlineDirective[] {
  const comments = (node as any).leadingComments as Comment[] | undefined;
  if (!comments) return [];
  // 不传 diags：不自成去重域——落外层 runWithDirectiveDiags 域（无则丢弃）
  if (!opts?.diags) return collectInlineDirectivesFromComments(comments);
  // 显式通道：sink 态仅在本次调用内生效（finally 恢复，异常不泄漏）
  const prev = activeDiagSink;
  activeDiagSink = { list: opts.diags, seen: new Set() };
  try {
    return collectInlineDirectivesFromComments(comments);
  } finally {
    activeDiagSink = prev;
  }
}

function collectInlineDirectivesFromComments(comments: readonly Comment[]): InlineDirective[] {
  const results: InlineDirective[] = [];
  for (const comment of comments) {
    // CommentLine（`//`）与 CommentBlock（`/* */`）都认（F-3 #10）
    if (comment.type !== "CommentLine" && comment.type !== "CommentBlock") continue;
    // S4-006：先剥 `* ` / `///` 前缀再逐行扫——多行块注释里的指令此前
    // 只取首个匹配且对 JSDoc 星号续行整体失明；一个块内多条指令各自生效
    const kind = comment.type === "CommentLine" ? "line" : "block";
    for (const rawLine of comment.value.split("\n")) {
      const line = stripInlineCommentPrefix(rawLine, kind);

      const asMatch = line.match(AS_LINE_REGEX);
      if (asMatch) {
        const rawExpr = asMatch[1].trim();
        // 尾注释残留（F-3 #9）：类型表达式后跟 `//` 或 `/*` → 不静默吞成 unknown
        const trailingIdx = findTrailingCommentStart(rawExpr);
        if (trailingIdx !== -1) {
          const typePart = rawExpr.slice(0, trailingIdx).trim();
          emitDirectiveDiag({
            code: "nudo:directive-syntax",
            message: `Trailing comment in @nudo:as type expression: '${rawExpr}' (remove the comment; the type must be a clean expression)`,
          });
          results.push({ kind: "as", typeAbs: typePart ? parseAbsExprDiag(typePart, "@nudo:as") : absUnknown() });
          continue;
        }
        results.push({ kind: "as", typeAbs: parseAbsExprDiag(rawExpr, "@nudo:as") });
        continue;
      }
      if (AS_BARE_RE.test(line)) {
        // 空载荷不再静默：`@nudo:as` 单独成行发显式诊断
        emitDirectiveDiag({
          code: "nudo:directive-syntax",
          message: `@nudo:as requires a type expression (e.g. @nudo:as number())`,
        });
        continue;
      }

      const replaceMatch = line.match(REPLACE_LINE_REGEX);
      if (replaceMatch) {
        const raw = replaceMatch[1].trim();
        const sepIdx = findReplaceSeparator(raw);
        if (sepIdx !== -1) {
          const targetSource = raw.slice(0, sepIdx).trim();
          const typeExprStr = raw.slice(sepIdx + 1).trim();
          results.push({
            kind: "replace",
            targetSource,
            typeAbs: parseAbsExprDiag(typeExprStr, "@nudo:replace"),
          });
        } else {
          emitDirectiveDiag({
            code: "nudo:directive-syntax",
            message: `Malformed @nudo:replace: cannot separate target from type (expected @nudo:replace <target> <typeExpr>) — got: ${raw.slice(0, 60)}`,
          });
        }
        continue;
      }
      if (REPLACE_BARE_RE.test(line)) {
        emitDirectiveDiag({
          code: "nudo:directive-syntax",
          message: `@nudo:replace requires a target and type expression (expected @nudo:replace <target> <typeExpr>)`,
        });
      }
    }
  }
  return results;
}

function findReplaceSeparator(raw: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      // 原样 slice：`\` 不是转义
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (ch === " " && depth === 0) {
      const rest = raw.slice(i + 1).trimStart();
      // type side: constraint builders / concrete literals / structure / never
      if (
        CONSTRAINT_EXPR_RE.test(rest) ||
        rest.startsWith("{") ||
        rest.startsWith("[") ||
        rest.startsWith('"') ||
        rest.startsWith("'") ||
        rest === "true" ||
        rest === "false" ||
        rest === "null" ||
        rest === "undefined" ||
        rest === "unknown" ||
        rest === "any" ||
        rest === "never" ||
        /^-?\d+(\.\d+)?$/.test(rest) ||
        rest.includes("=>") ||
        /^function\s*[\w$]*\s*\(/.test(rest)
      ) {
        return i;
      }
    }
  }
  return -1;
}

// 文件级指令前缀契约（D5=F1）：`//` 与 `///` 等价（comment.value 已剥掉首个 `//`，
// `///` 形态残留一个 `/`，`//` 形态是空白/原文）。只认 CommentLine 行注释，
// 块注释与字符串里的同形文本不算。载荷文法在 core directive-scan 单源。
const ENV_REGEX = /^\/?\s*@nudo:env\s+(.+)/;
const MOCK_MODULE_REGEX = /^\/?\s*@nudo:mock-module\s+(.+)/;

export function extractFileDirectives(ast: Node): FileDirective[] {
  const results: FileDirective[] = [];
  if (ast.type !== "File") return results;

  const comments: readonly Comment[] = (ast as any).comments ?? [];
  for (const comment of comments) {
    if (comment.type !== "CommentLine") continue;
    const text = comment.value;

    const mockModuleMatch = text.match(MOCK_MODULE_REGEX);
    if (mockModuleMatch) {
      const rec = parseMockModulePayload(mockModuleMatch[1]!);
      if (rec) {
        results.push({
          kind: "mock-module",
          source: rec.source,
          ...(rec.names ? { names: rec.names } : {}),
          fromPath: rec.fromPath,
        });
        continue;
      }
    }

    const envMatch = text.match(ENV_REGEX);
    if (envMatch) {
      const envs = parseEnvPayload(envMatch[1]!);
      if (envs.length > 0) results.push({ kind: "env", envs });
    }
  }

  return results;
}
