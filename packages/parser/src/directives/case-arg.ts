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
 */
export function parseAbsExprDiag(expr: string, context: string): Abs {
  const abs = parseCaseArgExpr(expr);
  if (abs.shape.k === "unknown" && !abs.term && !isExplicitUnknownExpr(expr)) {
    emitDirectiveDiag({
      code: DIAG.directiveSyntax,
      message: `Unrecognized type expression in ${context}: ${expr.trim()} (use constraint builders, literals, or structure syntax)`,
    });
  }
  return abs;
}
