import type { Node } from "@babel/types";
import {
  type Abs,
  type NudoConstraint,
  type Pred,
  abs as makeAbs,
  absFunction,
  joinAbs,
  numLit,
  strLit,
  boolLit,
  bigintLit,
  litValue,
  execNudoModule,
  isNudoConstraint,
  constraintToEntryAbs,
  CONSTRAINT_BUILDER_NAMES,
  CONSTRAINT_EXPR_RE,
  SELF,
} from "@nudojs/core";
// 字面量助手单源：core/internal 的 absLit（env/harvester/service 测试同源）
import { absLit, DIAG } from "@nudojs/core/internal";
import { parse as babelParse } from "../parse.ts";
import { emitDirectiveDiag } from "./diag.ts";
import {
  findTopLevelArrow,
  findTopLevelColon,
  parseArrowFunctionExpr,
  splitTopLevelArgs,
} from "./expr-scan.ts";
// 字符串字面量判定与转义解释单源（case 实参 / 期望值 / skip / mock 载荷共用）
import { scanStringLiteral } from "./string-literal.ts";

function absExact(shape: Abs["shape"]): Abs {
  return makeAbs(shape, undefined, undefined, "exact");
}

export function absUnknown(): Abs {
  return makeAbs({ k: "unknown" }, undefined, undefined, "partial");
}

function absUnion(members: Abs[]): Abs {
  if (members.length === 0) return absExact({ k: "never" });
  return members.reduce((acc, m) => joinAbs(acc, m));
}

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
      code: DIAG.directiveSyntax,
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
    const slots: Record<string, { value: Abs; optional?: boolean }> = {};
    for (const [key, field] of Object.entries(c.fields)) {
      slots[key] = {
        value: constraintToCaseArgAbs(field.constraint, depth + 1),
        // 可选标记必须投影进槽（与 core 的 constraintToEntryAbs 同口径）：
        // 丢掉它 ⇒ 可选槽变必填 ⇒ 缺该字段的**合法**实际值被判红，
        // 且报出的 expected 文案不带 `?`（与契约面同文法自相矛盾）。
        ...(field.optional || field.constraint.isOptional ? { optional: true } : {}),
      };
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
    code: DIAG.directiveSyntax,
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
      // 严格性不可得：本文法只拿到**指令表达式文本**，enclosing 源文件的
      // ESM/CJS 种类未随 `@nudo:case` 流转 ⇒ 不写 strict（sloppy，保守；
      // body-fn 只看 `strict === true`）。不得按表达式形态猜。
      return absFunction(fnExpr.params, { body: fnExpr.body });
    }
  }

  // 数字字面量：按 **JS 字面量语义** 解析（指数 / 进制 / 分隔符 / 前导点 /
  // 一元 / 括号 / bigint / Infinity / NaN / legacy octal 全部覆盖）——
  // 旧实现只认一条十进制正则，其余**合法**写法落 unknown（顶类型 ⇒
  // 见证满足任何契约 = 假绿，Bug 839 / 853 / 854）。
  const numAbs = parseNumberLiteralExpr(s);
  if (numAbs) return numAbs;

  // 字符串字面量：整段文本必须**恰好**是一个 JS 字符串字面量。
  // - 转义按 JS 语义解释（`"a\tb"` → `a<TAB>b`）：旧实现只 slice 不反转义 ⇒
  //   见证值含字面反斜杠 ⇒ 与侧车契约（真实 JS 求值）不是同一个字符串（假红）。
  // - 闭合引号之后还有文本 ⇒ 是表达式不是字面量（`"a" + "b"`）：旧实现把
  //   首尾引号之间的**运算符文本**一起吞进值里 ⇒ 折出自信的错值（假红）。
  // 判定与转义解释单源在 ./string-literal.ts（case / skip / mock 三个面共用）。
  if (s.startsWith('"') || s.startsWith("'")) {
    const scan = scanStringLiteral(s);
    if (scan.kind === "literal") return absLit(scan.value);
    // 不是单个字面量 ⇒ 当「不认识」（unknown）；诊断由 parseAbsExprDiag /
    // mock 载荷的 silentFallback 通道给出，不再折出错值。
    return absUnknown();
  }

  // 结构字面量（对象 / 数组）：整段文本必须**恰好**是一个字面量。
  // 只看首尾字符 ⇒ 尾随文本被吞进槽位 / 元素（`[1][0]` → `[unknown]`、
  // `{ a: 1 } + { b: 2 }` → `{ a: unknown }`）⇒ 折出**自信的错值**（假红）。
  // 整段校验不过 ⇒ 当「不认识」（unknown；诊断由 parseAbsExprDiag /
  // mock 载荷的 silentFallback 通道给出），不再硬切。
  if (s.startsWith("{") || s.startsWith("[")) {
    // 超深结构先走**深度闸门**（诊断 + unknown 折叠）：既保住 BUG-014 的
    // 「nesting」诊断口径，也不让整段 AST 解析去处理病态输入。
    if (literalNestingDepth(s) > MAX_CASE_ARG_DEPTH) return depthCapDiag(s);
    const kind = structureLiteralKind(s);
    if (kind === "obj") {
      return parseObjectLiteral(s.slice(1, -1).trim(), depth);
    }
    if (kind === "arr") {
      const content = s.slice(1, -1).trim();
      if (!content) return absExact({ k: "tuple", elements: [] });
      const elements = splitTopLevelArgs(content);
      return absExact({
        k: "tuple",
        elements: elements.map((e) => parseCaseArgExpr(e, depth + 1)),
      });
    }
    return absUnknown();
  }

  // 模板字面量（无插值）：`x` → 字符串字面量（有插值 ⇒ 不是字面量 ⇒ unknown）
  const templateAbs = parseTemplateLiteralExpr(s);
  if (templateAbs) return templateAbs;

  // `T.*` 及其它未知标识符：明确不再解析
  return absUnknown();
}

/**
 * 结构字面量的括号嵌套深度（字符串感知，与 expr-scan 的扫描口径一致）。
 *
 * 只用于**深度闸门**的前置判断：超深文本不进入整段 AST 解析（病态输入
 * 不得借解析器打穿宿主栈），直接走 depthCapDiag 的诊断 + unknown 折叠。
 */
function literalNestingDepth(s: string): number {
  let depth = 0;
  let max = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      if (depth > max) max = depth;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
    }
  }
  return max;
}

/**
 * 结构字面量形态校验：整段文本必须**恰好**是一个对象 / 数组字面量。
 *
 * 语法错（`{ a: 1 } + { b: 2 }`、`[1][0]`、尾随文本）或根节点类型不符
 * ⇒ undefined（= 不认识）。Babel 已是本包解析单源（`../parse.ts`），
 * 与「首尾字符」启发相比能真正切出词法边界。
 */
function structureLiteralKind(s: string): "obj" | "arr" | undefined {
  try {
    // 包成单表达式语句：`( … );` 让 `{…}` 走对象字面量分支（语句位置是块）。
    const ast = babelParse(`(${s});`);
    if (ast.program.body.length !== 1) return undefined;
    const stmt = ast.program.body[0];
    if (stmt.type !== "ExpressionStatement") return undefined;
    const expr = stmt.expression;
    if (expr.type === "ObjectExpression") return "obj";
    if (expr.type === "ArrayExpression") return "arr";
    return undefined;
  } catch {
    return undefined;
  }
}

function parseObjectLiteral(content: string, depth: number): Abs {
  if (!content) return absExact({ k: "obj", slots: {} });
  const entries = splitTopLevelArgs(content);
  const slots: Record<string, { value: Abs }> = {};
  for (const entry of entries) {
    const colonIdx = findTopLevelColon(entry);
    if (colonIdx === -1) {
      // 无顶层冒号的属性（getter / 方法简写 / 简写属性）：此前**静默 continue**
      // ⇒ 该属性从 mock / 期望值里无声消失 ⇒ mock 变成自信的错值且零诊断。
      // 现在：点名报诊断 + 整个字面量判「不认识」（unknown，fail-closed）。
      emitDirectiveDiag({
        code: DIAG.directiveSyntax,
        message: `Unrecognized property in object literal: ${entry.slice(0, 60)} (getter / method shorthand / shorthand property are not supported in directive payloads)`,
      });
      return absUnknown();
    }
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
  // 数值：与 case 实参**同一**数值文法（指数 / 进制 / 分隔符 / legacy octal …）——
  // 旧实现同族第二处仍只认十进制正则（017 → 17，与 JS 字面量语义不符）。
  const numAbs = parseNumberLiteralExpr(s);
  if (numAbs) {
    const value = litValue(numAbs);
    if (value.ok && typeof value.value === "number") return value.value;
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** 显式 unknown 形态：`unknown` / `any` / `any()`——合法的 unknown，不是解析失败 */
function isExplicitUnknownExpr(expr: string): boolean {
  const s = expr.trim();
  return s === "unknown" || s === "any" || s === "any()";
}

/** 实参/期望/mock 返回值文法 → Abs（约束构建器 / 具体字面量） */
export function parseAbsExpr(expr: string): Abs {
  return parseCaseArgExpr(expr);
}

/**
 * 解析表达式并在静默 fallback 到 unknown 时发诊断（I2）。
 * 显式 `unknown`/`any`/`any()` 不算 fallback；`T.*` 等不可识别形态发 nudo:directive-syntax。
 *
 * **断言面（`@nudo:case "…" => expected`）的解析失败不得折成 unknown Abs**：
 * unknown 是顶类型（`leqAbs(actual, unknown)` 恒 ok）⇒ 断言**空洞通过**
 * （报「1 passed」、exit 0 = 假绿，Bug 837 / 841）。失败改用**失败表示**
 * （never，底类型）⇒ 没有任何实际值满足它 ⇒ 断言判 FAIL（fail-closed），
 * 且与「显式 unknown」在 Abs 层面**不可混淆**（shape.k = "never" ≠ "unknown"）。
 */
export function parseAbsExprDiag(expr: string, context: string): Abs {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k === "unknown" && !abs.term && !isExplicitUnknownExpr(expr)) {
    emitUnrecognizedExprDiag(expr, context);
    if (isCaseExpectedContext(context)) return absParseFailure();
  }
  return abs;
}

/**
 * 断言面期望值专用（严格）：解析失败 ⇒ **undefined**（不是 unknown Abs）。
 *
 * 与 parseAbsExprDiag 的差别：失败时**不**产出 unknown Abs，而是给 undefined ——
 * 调用方（fn-directives.ts 的期望值解析点）据此**不设置** directive.expected
 * ⇒ 该 case 落断言面的 unchecked 分支（「没被检查」），而不是空洞通过。
 *
 * 供下游按「unchecked」口径收口时使用（parseAbsExprDiag 默认走 fail-closed 的
 * never 口径：断言判 FAIL + 非 0 退出）。
 */
export function parseCaseExpectedAbs(expr: string, context: string): Abs | undefined {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k === "unknown" && !abs.term && !isExplicitUnknownExpr(expr)) {
    emitUnrecognizedExprDiag(expr, context);
    return undefined;
  }
  return abs;
}

/** 「不认识这个表达式」的统一诊断（case / skip / mock 共用同一文案口径）。 */
function emitUnrecognizedExprDiag(expr: string, context: string): void {
  emitDirectiveDiag({
    code: DIAG.directiveSyntax,
    message: `Unrecognized type expression in ${context}: ${expr.trim()} (use constraint builders, literals, or structure syntax)`,
  });
}

/**
 * 断言面（`@nudo:case "…" => expected`）的解析失败表示（Bug 837 / 841）。
 *
 * 「解析失败」与「显式 unknown」必须**可区分**：
 * - 显式 unknown（`=> unknown` / `any` / `any()`）= 顶类型 ⇒ 通吃任何契约（用户主动声明）。
 * - 解析失败（`=> 2n` / `=> bogus()` / 残缺表达式）= **读不懂用户的期望**。
 * 旧实现把失败折成 unknown Abs ⇒ `leqAbs(actual, unknown)` 恒 ok ⇒ 断言空洞通过。
 * 失败表示用 never（底类型）：没有任何实际值满足它 ⇒ 断言判 FAIL（fail-closed）。
 */
function absParseFailure(): Abs {
  return absExact({ k: "never" });
}

/**
 * 断言面上下文判定：`@nudo:case "name" => expected`（fn-directives.ts 拼装）。
 *
 * 只有**期望值**上下文启用 fail-closed 失败表示：见证 / `@nudo:as` /
 * `@nudo:replace` / `@nudo:skip` 上下文的 Abs 会进求值面或类型覆盖面，
 * never 会污染那里的语义（never 见证会让 case 求值退化成 unknown，
 * never 类型覆盖会让整段声明退化成 never ⇒ 假红）。
 */
function isCaseExpectedContext(context: string): boolean {
  return /^@nudo:case\b/.test(context) && /=>\s*expected\s*$/.test(context);
}

// ---------------------------------------------------------------------------
// 数字 / 数值表达式文法（Bug 839 / 853 / 854）
//
// 旧实现只有一条十进制正则（/^-?\d+(\.\d+)?$/）：指数 / 进制 / 分隔符 /
// 前导点 / 一元 / 括号等**合法** JS 数字写法一律落 unknown —— 而 unknown 是
// 顶类型（`leqAbs(actual, unknown)` 恒 ok ⇒ 见证满足任何契约 = 假绿）。
// legacy octal（017）还被 `Number("017")` 按十进制读成 17（native sloppy 是
// 15 = 八进制）⇒ 折出**自信的错值**（假红）。
//
// 修法：按 **JS 字面量语义** 解析 ——
// - 快速路径：普通十进制（无前导零 / 无分隔符 / 无指数）⇒ 零解析开销；
// - legacy 前导零：全八进制数字 ⇒ 八进制取值（017 → 15）；含 8/9 ⇒ sloppy
//   十进制（08 → 8）；
// - 其余形态（指数 / 进制 / 分隔符 / 前导点 / 一元 / 括号 / bigint /
//   Infinity / NaN）⇒ 交给 Babel（本包解析单源）给真正的词法边界。
// ---------------------------------------------------------------------------

/** 普通十进制快速路径：无前导零（`0` / `0.x` 除外）、无分隔符、无指数。 */
const PLAIN_DECIMAL_RE = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** legacy 前导零：可选符号 + `0` + 至少一位数字（八进制或 sloppy 十进制）。 */
const LEGACY_LEADING_ZERO_RE = /^([+-]?)0([0-9]+)$/;

/**
 * legacy 前导零取值：全八进制数字 ⇒ 八进制（`017` → 15，与 native sloppy 一致）；
 * 含 8/9 ⇒ sloppy 十进制（`08` → 8）。不是前导零形态 ⇒ undefined。
 */
function legacyLeadingZeroValue(s: string): number | undefined {
  const m = LEGACY_LEADING_ZERO_RE.exec(s);
  if (!m) return undefined;
  const sign = m[1] === "-" ? -1 : 1;
  const digits = `0${m[2]}`;
  if (/^0[0-7]+$/.test(digits)) return sign * parseInt(digits, 8);
  return sign * Number(digits);
}

/** 指令表达式文本 → 单个表达式 AST 节点；不是单个表达式 / 语法错 ⇒ undefined。 */
function parseDirectiveExprNode(s: string): Node | undefined {
  try {
    // 包成单表达式语句：`( … );` 让 `{…}` 走对象字面量分支（语句位置是块）。
    const ast = babelParse(`(${s});`);
    if (ast.program.body.length !== 1) return undefined;
    const stmt = ast.program.body[0];
    if (stmt.type !== "ExpressionStatement") return undefined;
    return stmt.expression;
  } catch {
    return undefined;
  }
}

/**
 * 数值节点 → 数值（number / bigint）；不是数值形态 ⇒ undefined。
 *
 * 覆盖 JS 数值字面量的全部合法形态：NumericLiteral（十进制 / 指数 / 进制 /
 * 分隔符）、BigIntLiteral、一元 `+` / `-`（`- 7` / `-(7)` / `+1`）、
 * 全局数值常量（`Infinity` / `NaN`）。
 */
function numericNodeValue(node: Node): number | bigint | undefined {
  switch (node.type) {
    case "NumericLiteral":
      return typeof node.value === "number" ? node.value : undefined;
    case "BigIntLiteral": {
      const raw = node.value as string | bigint;
      try {
        return typeof raw === "bigint" ? raw : BigInt(raw);
      } catch {
        return undefined;
      }
    }
    case "UnaryExpression": {
      // 一元 +/-：只认数值实参（`-"a"` 不是数值形态）
      if (node.operator !== "+" && node.operator !== "-") return undefined;
      const inner = numericNodeValue(node.argument);
      if (inner === undefined) return undefined;
      if (node.operator === "+") return inner;
      return typeof inner === "bigint" ? -inner : -inner;
    }
    case "Identifier":
      // 全局数值常量（语义上是数值字面量面，但不是关键字）
      if (node.name === "Infinity") return Infinity;
      if (node.name === "NaN") return NaN;
      return undefined;
    default:
      return undefined;
  }
}

/**
 * 数字 / 数值表达式 → Abs（JS 字面量语义）。
 *
 * 不是数值形态 ⇒ undefined（= 不认识；调用方回落 unknown + 诊断）。
 */
function parseNumberLiteralExpr(s: string): Abs | undefined {
  const body = s.trim();
  // 快速路径：普通十进制（最常见形态，零解析开销）
  if (PLAIN_DECIMAL_RE.test(body)) return numLit(Number(body));
  // legacy 前导零：八进制 / sloppy 十进制（strict 口径下 Babel 直接报错 ⇒ 手工判定）
  const legacy = legacyLeadingZeroValue(body);
  if (legacy !== undefined) return numLit(legacy);
  // 其余形态 ⇒ Babel（真解析器）给词法边界
  const node = parseDirectiveExprNode(body);
  if (!node) return undefined;
  const value = numericNodeValue(node);
  if (value === undefined) return undefined;
  if (typeof value === "bigint") return bigintLit(value);
  return numLit(value);
}

/**
 * 兜底形态：无插值模板字面量（`` `x` ``）→ 字符串字面量。
 *
 * 有插值 / 不是单个模板 ⇒ 不认识（unknown + 诊断）。模板的转义解释与
 * 引号字符串共用 Babel 的 cooked 值口径。
 */
function parseTemplateLiteralExpr(s: string): Abs | undefined {
  const body = s.trim();
  if (!body.startsWith("`") || !body.endsWith("`") || body.length < 2) return undefined;
  const node = parseDirectiveExprNode(body);
  if (!node || node.type !== "TemplateLiteral") return undefined;
  if (node.expressions.length > 0) return undefined;
  const cooked = node.quasis[0]?.value.cooked;
  if (typeof cooked !== "string") return undefined;
  return strLit(cooked);
}
