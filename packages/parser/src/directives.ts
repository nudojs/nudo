import type { Node, Comment } from "@babel/types";
import {
  type TypeValue,
  type Abs,
  type MockHelper,
  type NudoConstraint,
  type Pred,
  T,

  stub,
  spy,
  mock,
  absFunction,
  execNudoModule,
  isNudoConstraint,
  constraintToEntryAbs,
  absToTypeValue,
  typeValueToAbs,
  numLit,
  strLit,
  boolLit,
  SELF,
} from "@nudojs/core";
import { parse as babelParse } from "./parse.ts";

/** TypeValue → Abs（MockHelper 值字段）；失败落 opaque unknown */
function tvToAbs(v: TypeValue): Abs {
  try {
    return typeValueToAbs(v);
  } catch {
    return { shape: { k: "unknown" }, conf: "opaque" };
  }
}

export type CaseDirective = {
  kind: "case";
  name: string;
  /** 无损参数 Abs（case 文法唯一真理源；约束表达式与 T.* 均产出） */
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

const CASE_NAME_REGEX = /@nudo:case\s+"([^"]+)"\s*\(/g;
const MOCK_INLINE_REGEX = /@nudo:mock\s+(\w+)\s*=\s*(.+)/g;
const MOCK_FROM_REGEX = /@nudo:mock\s+(\w+)\s+from\s+"([^"]+)"/g;
const PURE_REGEX = /@nudo:pure\b/g;
const SKIP_REGEX = /@nudo:skip(?:\s+(.+))?/g;
const SAMPLE_REGEX = /@nudo:sample\s+(\d+)/g;

/**
 * 约束表达式（design-refine-derivation：case 实参主文法）。
 * 识别 `number()` / `number().gt(0)` / `lit(42)` / `union(…)` / `shape({…})` /
 * `array(…)` / `fn({…}, …)` / `partial` / `pick` / `omit` / `and` 等构建器。
 * 不匹配 `T.*`（TypeValue 兼容文法）与裸字面量 / 箭头函数。
 */
const CONSTRAINT_EXPR_RE =
  /^(number|string|boolean|array|shape|lit|union|fn|partial|pick|omit|record|required|readonly|nonNullable|and)\s*\(/;

/** 约束表达式 → NudoConstraint；非约束文法或执行失败 → undefined */
function tryParseConstraint(expr: string): NudoConstraint | undefined {
  const s = expr.trim();
  if (!CONSTRAINT_EXPR_RE.test(s)) return undefined;
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
function constraintSelfEqLit(
  c: NudoConstraint,
  selfIds: string[],
): number | string | boolean | null | undefined {
  const leaves = flattenPreds(c.preds);
  const eqs = leaves.filter((p) => p.op === "eq");
  if (eqs.length !== 1) return undefined;
  const p = eqs[0]!;
  if (p.op !== "eq") return undefined;
  const isSelf = (t: { op: string; id?: string }): boolean =>
    t.op === "var" && typeof t.id === "string" && selfIds.includes(t.id);
  const a = p.a;
  const b = p.b;
  if (isSelf(a) && b.op === "lit") return b.value as number | string | boolean | null;
  if (isSelf(b) && a.op === "lit") return a.value as number | string | boolean | null;
  return undefined;
}

/**
 * case 实参约束 → Abs。lit 优先成字面量 Abs（term=lit，不是 var+eq）；
 * union 成员递归再拼 sum（同 prim 双 lit 不经 joinValues 急切塌缩）；
 * 其余走 constraintToEntryAbs（var 项 + pred）。
 */
function constraintToCaseArgAbs(c: NudoConstraint): Abs {
  if (c.members && c.members.length > 0) {
    const parts = c.members.map((m) => constraintToCaseArgAbs(m));
    if (parts.length === 1) return parts[0]!;
    return { shape: { k: "sum", members: parts }, conf: "path" };
  }
  const selfIds = [SELF, "__arg", "__nudo_self__"];
  const lv = constraintSelfEqLit(c, selfIds);
  if (typeof lv === "number" && !Number.isNaN(lv)) return numLit(lv);
  if (typeof lv === "string") return strLit(lv);
  if (typeof lv === "boolean") return boolLit(lv);
  return constraintToEntryAbs(c, "__arg");
}

export function parseTypeValueExpr(expr: string): TypeValue {
  // 约束表达式优先：number() / lit(42) / shape({…}) / …
  const constraint = tryParseConstraint(expr);
  if (constraint) {
    try {
      return absToTypeValue(constraintToCaseArgAbs(constraint));
    } catch {
      return T.unknown;
    }
  }
  return parseTypeValueExprLegacy(expr);
}

/**
 * case 实参主路径：始终产出 Abs；约束表达式优先。
 * `T.*` 文法 **已弃用**，仅为旧 fixture 兼容保留——新代码用 `number()`/`lit()`。
 */
export function parseCaseArgExpr(expr: string): { typeValue: TypeValue; abs: Abs } {
  const constraint = tryParseConstraint(expr);
  if (constraint) {
    try {
      const absVal = constraintToCaseArgAbs(constraint);
      return { typeValue: absToTypeValue(absVal), abs: absVal };
    } catch {
      return { typeValue: T.unknown, abs: { shape: { k: "unknown" }, conf: "opaque" } };
    }
  }
  const tv = parseTypeValueExprLegacy(expr);
  return { typeValue: tv, abs: tvToAbs(tv) };
}

function parseTypeValueExprLegacy(expr: string): TypeValue {
  const s = expr.trim();

  if (s === "T.number") return T.number;
  if (s === "T.string") return T.string;
  if (s === "T.boolean") return T.boolean;
  if (s === "T.unknown") return T.unknown;
  if (s === "T.never") return T.never;
  if (s === "T.null") return T.null;
  if (s === "T.undefined") return T.undefined;

  if (s === "true") return T.literal(true);
  if (s === "false") return T.literal(false);
  if (s === "null") return T.literal(null);
  if (s === "undefined") return T.literal(undefined);

  const literalMatch = s.match(/^T\.literal\((.+)\)$/);
  if (literalMatch) {
    return T.literal(parsePrimitiveValue(literalMatch[1].trim()));
  }

  if (s.startsWith("T.union(") && s.endsWith(")")) {
    const inner = s.slice("T.union(".length, -1);
    const args = splitTopLevelArgs(inner);
    return T.union(...args.map(parseTypeValueExprLegacy));
  }

  if (s.startsWith("T.array(") && s.endsWith(")")) {
    const inner = s.slice("T.array(".length, -1);
    return T.array(parseTypeValueExprLegacy(inner));
  }

  if (s.startsWith("T.tuple(") && s.endsWith(")")) {
    const inner = s.slice("T.tuple(".length, -1).trim();
    if (inner.startsWith("[") && inner.endsWith("]")) {
      const elements = splitTopLevelArgs(inner.slice(1, -1));
      return T.tuple(elements.map(parseTypeValueExprLegacy));
    }
    return T.tuple([]);
  }

  if (s.startsWith("T.object(") && s.endsWith(")")) {
    const inner = s.slice("T.object(".length, -1).trim();
    if (inner.startsWith("{") && inner.endsWith("}")) {
      const content = inner.slice(1, -1).trim();
      if (!content) return T.object({});
      const entries = splitTopLevelArgs(content);
      const props: Record<string, TypeValue> = {};
      for (const entry of entries) {
        const colonIdx = entry.indexOf(":");
        if (colonIdx === -1) continue;
        const key = entry.slice(0, colonIdx).trim();
        const val = entry.slice(colonIdx + 1).trim();
        props[key] = parseTypeValueExprLegacy(val);
      }
      return T.object(props);
    }
    return T.object({});
  }

  // Function literals: (x) => expr, x => expr, (x, y) => expr, function(x) { ... }
  if (findTopLevelArrow(s) !== -1 || /^function\s*[\w$]*\s*\(/.test(s)) {
    const fnExpr = parseArrowFunctionExpr(s);
    if (fnExpr) {
      const fnType = T.fn(fnExpr.params, fnExpr.body, null);
      (fnType as any)._paramPatterns = fnExpr.paramPatterns;
      return fnType;
    }
  }

  if (/^-?\d+(\.\d+)?$/.test(s)) return T.literal(Number(s));

  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return T.literal(s.slice(1, -1));
  }

  if (s.startsWith("{") && s.endsWith("}")) {
    const content = s.slice(1, -1).trim();
    if (!content) return T.object({});
    const entries = splitTopLevelArgs(content);
    const props: Record<string, TypeValue> = {};
    for (const entry of entries) {
      const colonIdx = findTopLevelColon(entry);
      if (colonIdx === -1) continue;
      const key = entry.slice(0, colonIdx).trim().replace(/^["']|["']$/g, "");
      const val = entry.slice(colonIdx + 1).trim();
      props[key] = parseTypeValueExprLegacy(val);
    }
    return T.object(props);
  }

  if (s.startsWith("[") && s.endsWith("]")) {
    const content = s.slice(1, -1).trim();
    if (!content) return T.tuple([]);
    const elements = splitTopLevelArgs(content);
    return T.tuple(elements.map(parseTypeValueExprLegacy));
  }

  return T.unknown;
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

function splitTopLevelArgs(s: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function findTopLevelColon(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

function findTopLevelArrow(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && ch === "=" && s[i + 1] === ">") return i;
  }
  return -1;
}

function extractBalancedParens(text: string, startIdx: number): string | null {
  if (text[startIdx] !== "(") return null;
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    if (depth === 0) return text.slice(startIdx + 1, i);
  }
  return null;
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

/** 实参/期望/mock 返回值文法 → Abs（约束表达式优先，T.* 兼容） */
function parseAbsExpr(expr: string): Abs {
  return parseCaseArgExpr(expr).abs;
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
  const s = expr.trim();

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

  // sinon 前缀链统一为同一 MockHelper 形态：strip 前缀后复用裸 stub 解析。
  // 解析不出的 sinon 链仍回落 sinonExpr 路径（parseSinonExpr 自己的分支）。
  if (s.startsWith("sinon.")) {
    return parseNudoMockExpr(s.slice("sinon.".length));
  }

  return null;
}

function parseDirectivesFromComments(comments: readonly Comment[]): Directive[] {
  const directives: Directive[] = [];
  for (const comment of comments) {
    const text = comment.value;

    MOCK_FROM_REGEX.lastIndex = 0;
    let mockFromMatch: RegExpExecArray | null;
    const mockFromRanges: [number, number][] = [];
    while ((mockFromMatch = MOCK_FROM_REGEX.exec(text)) !== null) {
      directives.push({
        kind: "mock",
        name: mockFromMatch[1],
        fromPath: mockFromMatch[2],
      });
      mockFromRanges.push([mockFromMatch.index, mockFromMatch.index + mockFromMatch[0].length]);
    }

    MOCK_INLINE_REGEX.lastIndex = 0;
    let mockMatch: RegExpExecArray | null;
    while ((mockMatch = MOCK_INLINE_REGEX.exec(text)) !== null) {
      const inFromRange = mockFromRanges.some(
        ([s, e]) => mockMatch!.index >= s && mockMatch!.index < e,
      );
      if (inFromRange) continue;

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
        name: mockMatch[1],
        expression: expr,
        arrowFn: arrowFn ?? undefined,
        sinonExpr: sinonExpr ?? undefined,
        nudoMock: nudoMock ?? undefined,
      });
    }

    CASE_NAME_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    const commentStartLine = comment.loc?.start.line ?? 0;
    while ((match = CASE_NAME_REGEX.exec(text)) !== null) {
      const name = match[1];
      const parenStart = match.index + match[0].length - 1;
      const argsStr = extractBalancedParens(text, parenStart);
      if (argsStr === null) continue;
      // 块注释续行的 ` * ` 前缀不属于实参文本（键名会被污染成 "* supplyChain"）
      const cleaned = argsStr
        .split("\n")
        .map((line) => line.replace(/^\s*\*\s?/, ""))
        .join("\n");
      const parsedArgs = splitTopLevelArgs(cleaned).map(parseCaseArgExpr);
      const argsAbs = parsedArgs.map((p) => p.abs);

      const afterParen = parenStart + argsStr.length + 2;
      const restLine = text.slice(afterParen).split("\n")[0].trim();
      const arrowMatch = restLine.match(/^=>\s*(.+)/);
      const expected = arrowMatch ? parseCaseArgExpr(arrowMatch[1].trim()).abs : undefined;

      const linesBeforeMatch = text.slice(0, match.index).split("\n").length - 1;
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
    if (PURE_REGEX.test(text)) {
      directives.push({ kind: "pure" });
    }

    SKIP_REGEX.lastIndex = 0;
    let skipMatch: RegExpExecArray | null;
    while ((skipMatch = SKIP_REGEX.exec(text)) !== null) {
      const returnsExpr = skipMatch[1]?.trim();
      directives.push({
        kind: "skip",
        returns: returnsExpr ? parseAbsExpr(returnsExpr) : undefined,
      });
    }

    SAMPLE_REGEX.lastIndex = 0;
    let sampleMatch: RegExpExecArray | null;
    while ((sampleMatch = SAMPLE_REGEX.exec(text)) !== null) {
      directives.push({ kind: "sample", count: Number(sampleMatch[1]) });
    }
  }
  return directives;
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

export function extractDirectives(ast: Node): FunctionWithDirectives[] {
  const results: FunctionWithDirectives[] = [];

  if (ast.type !== "File") return results;
  const body = ast.program.body;

  for (const stmt of body) {
    const leadingComments = stmt.leadingComments;
    if (!leadingComments || leadingComments.length === 0) continue;

    const directives = parseDirectivesFromComments(leadingComments);
    if (directives.length === 0) continue;

    const name = getFunctionName(stmt);
    results.push({ node: stmt, name, directives });
  }

  return results;
}

const AS_REGEX = /^\s*@nudo:as\s+(.+)/;
const REPLACE_REGEX = /^\s*@nudo:replace\s+(.+)/;

export function extractInlineDirectives(node: Node): InlineDirective[] {
  const comments = (node as any).leadingComments as Comment[] | undefined;
  if (!comments) return [];

  const results: InlineDirective[] = [];
  for (const comment of comments) {
    if (comment.type !== "CommentLine") continue;
    const text = comment.value;

    const asMatch = text.match(AS_REGEX);
    if (asMatch) {
      results.push({ kind: "as", typeAbs: parseAbsExpr(asMatch[1].trim()) });
      continue;
    }

    const replaceMatch = text.match(REPLACE_REGEX);
    if (replaceMatch) {
      const raw = replaceMatch[1].trim();
      const sepIdx = findReplaceSeparator(raw);
      if (sepIdx !== -1) {
        const targetSource = raw.slice(0, sepIdx).trim();
        const typeExprStr = raw.slice(sepIdx + 1).trim();
        results.push({
          kind: "replace",
          targetSource,
          typeAbs: parseAbsExpr(typeExprStr),
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
      if (ch === inString && raw[i - 1] !== "\\") inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (ch === " " && depth === 0) {
      const rest = raw.slice(i + 1).trimStart();
      if (rest.startsWith("T.") || rest.startsWith("{") || rest.startsWith("[") ||
          rest.startsWith('"') || rest.startsWith("'") ||
          /^-?\d/.test(rest) || rest === "true" || rest === "false" ||
          rest === "null" || rest === "undefined") {
        return i;
      }
    }
  }
  return -1;
}

const ENV_REGEX = /^\/\s*@nudo:env\s+(.+)/;
const MOCK_MODULE_REGEX = /^\/\s*@nudo:mock-module\s+"([^"]+)"\s+from\s+"([^"]+)"/;
const MOCK_MODULE_PARTIAL_REGEX = /^\/\s*@nudo:mock-module\s+"([^"]+)"\s*\{([^}]+)\}\s*from\s+"([^"]+)"/;

export function extractFileDirectives(ast: Node): FileDirective[] {
  const results: FileDirective[] = [];
  if (ast.type !== "File") return results;

  const comments: readonly Comment[] = (ast as any).comments ?? [];
  for (const comment of comments) {
    if (comment.type !== "CommentLine") continue;
    const text = comment.value;

    const partialMatch = text.match(MOCK_MODULE_PARTIAL_REGEX);
    if (partialMatch) {
      const names = partialMatch[2].split(",").map((n) => n.trim()).filter(Boolean);
      results.push({
        kind: "mock-module",
        source: partialMatch[1],
        names,
        fromPath: partialMatch[3],
      });
      continue;
    }

    const mockModuleMatch = text.match(MOCK_MODULE_REGEX);
    if (mockModuleMatch) {
      results.push({
        kind: "mock-module",
        source: mockModuleMatch[1],
        fromPath: mockModuleMatch[2],
      });
      continue;
    }

    const envMatch = text.match(ENV_REGEX);
    if (envMatch) {
      const envs = envMatch[1].split(",").map((e) => e.trim()).filter(Boolean);
      results.push({ kind: "env", envs });
    }
  }

  return results;
}
