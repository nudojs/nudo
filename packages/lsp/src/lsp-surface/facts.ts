/**
 * LSP 表面 — 流窄化事实域（守卫走查提取）。
 *
 * owns：光标位置的流敏感窄化事实（FlowFacts：早退 nullish 守卫 →
 * nonNullish、参数再赋值 → 重置、等值守卫 → 判别过滤），语句级走查
 * （walkStmtsForFacts）与守卫谓词判定（isNullishGuardOn /
 * collectTypeFilters / typeEqualityValue / literalStringValue 等）。
 * 供 paramDisplayOf（hover.ts）叠加声明形态窄化。
 * 不 owns：判别窄化的臂过滤（narrowing.ts——消费本模块产出的
 * filters）、位置映射（position.ts）。
 */
import type { Node } from "@babel/types";
import { containsPos, findIdentParent, posCmp } from "./position.ts";
/** 流窄化事实（有界规则集，见 paramDisplayOf） */
export type FlowFacts = {
  nonNullish: boolean;
  /**
   * `p.type === 'lit'` 等值守卫（判别窄化）：每个
   * filter 是该位置必须匹配的 type 值集（`&&` 链的
   * 操作数——单等值守卫为单值集、`||` 组为多值集；
   * 臂须匹配所有 filter）。then 分支内生效
   * （test 求值语义）；else 分支不窄化（否定形态
   * 有界跳过）
   */
  typeFilters: Array<Set<string>>;
};

export function flowFactsAt(
  fnNode: Node,
  file: Node,
  paramName: string,
  line: number,
  column: number,
): FlowFacts {
  const facts: FlowFacts = { nonNullish: false, typeFilters: [] };
  // 成员访问对象规则：光标标识符是非可选成员访问的对象
  const hit = findIdentParent(file, line, column);
  if (
    hit &&
    hit.name === paramName &&
    isNonNullishMemberObject(hit.parent, hit.ident)
  ) {
    facts.nonNullish = true;
  }
  // 早退守卫规则：从函数体起点按序走查，位置之前的语句
  // 生效（早退守卫 → nonNullish；参数赋值 → 重置）
  const body = (fnNode as { body?: { body?: Node[] } }).body?.body;
  if (body) walkStmtsForFacts(body, paramName, line, column, facts);
  return facts;
}

/** 非可选成员访问的对象（`node.x` 隐含 node 非 nullish；`node?.x` 不窄化） */
function isNonNullishMemberObject(parent: Node, ident: Node): boolean {
  const p = parent as unknown as {
    type: string;
    object?: Node;
    optional?: boolean;
  };
  return (
    p.type === "MemberExpression" &&
    p.object === ident &&
    p.optional !== true
  );
}

/** 语句级事实走查：位置之前生效，位置所在语句递归入内 */
function walkStmtsForFacts(
  stmts: Node[],
  paramName: string,
  line: number,
  column: number,
  facts: FlowFacts,
): void {
  const pos = { line, column };
  for (const s of stmts) {
    const loc = s.loc;
    if (!loc) continue;
    if (posCmp(loc.end, pos) <= 0) {
      applyStmtFact(s, paramName, facts);
      continue;
    }
    if (posCmp(loc.start, pos) <= 0) {
      if (s.type === "IfStatement") {
        const ifS = s as unknown as {
          test: Node;
          consequent: Node;
          alternate?: Node | null;
        };
        // then 分支：test 的等值守卫生效（判别窄化 +
        // 成员访问隐含非空）；else 分支不窄化。
        // 位置在 consequent 内——该分支的事实即
        // 位置的事实：追加后不再恢复（walk 在
        // 包含语句处终止，事实为最终值）
        if (containsPos(ifS.consequent, line, column)) {
          const testFilters = collectTypeFilters(ifS.test, paramName);
          if (testFilters.length > 0) {
            facts.typeFilters = [...facts.typeFilters, ...testFilters];
            facts.nonNullish = true;
          }
          recurseIntoBlock(ifS.consequent);
          return;
        }
        recurseIntoBlock(ifS.consequent);
        if (ifS.alternate) recurseIntoBlock(ifS.alternate);
      } else if (s.type === "SwitchStatement") {
        for (const c of (s as unknown as { cases: Node[] }).cases) {
          const cons = (c as unknown as { consequent?: Node[] }).consequent;
          if (
            Array.isArray(cons) &&
            cons.some((st) => containsPos(st, line, column))
          ) {
            walkStmtsForFacts(cons, paramName, line, column, facts);
          }
        }
      } else {
        for (const nested of nestedBlocksOf(s)) {
          if (containsPos(nested, line, column)) {
            walkStmtsForFacts(
              (nested as unknown as { body: Node[] }).body,
              paramName,
              line,
              column,
              facts,
            );
          }
        }
      }
      return;
    }
    // 语句起点在位置之后——后续语句不生效
    return;
  }
  function recurseIntoBlock(n: Node): void {
    if (!containsPos(n, line, column)) return;
    if (n.type === "BlockStatement") {
      walkStmtsForFacts(
        (n as unknown as { body: Node[] }).body,
        paramName,
        line,
        column,
        facts,
      );
    } else {
      walkStmtsForFacts([n], paramName, line, column, facts);
    }
  }
}

/** 非 if/switch 语句内嵌的块（函数体除外——窄化不跨函数边界） */
function nestedBlocksOf(s: Node): Node[] {
  const out: Node[] = [];
  const t = s as unknown as {
    body?: unknown;
    block?: unknown;
    finalizer?: unknown;
    handler?: unknown;
  };
  const add = (n: unknown): void => {
    if (n !== null && typeof n === "object" && (n as Node).type === "BlockStatement") {
      out.push(n as Node);
    }
  };
  add(t.body);
  add(t.block);
  add(t.finalizer);
  add((t.handler as { body?: unknown } | undefined)?.body);
  return out;
}

/** 位置之前语句的窄化效果：早退守卫 → nonNullish；参数赋值 → 重置 */
function applyStmtFact(s: Node, paramName: string, facts: FlowFacts): void {
  if (isParamReassignment(s, paramName)) {
    facts.nonNullish = false;
    facts.typeFilters = [];
    return;
  }
  if (s.type !== "IfStatement") return;
  const ifS = s as unknown as { test: Node; consequent: Node };
  if (!isNullishGuardOn(ifS.test, paramName)) return;
  if (endsWithReturnThrow(ifS.consequent)) facts.nonNullish = true;
}

/**
 * test 的 `p.type === 'lit'` 等值守卫收集
 * （判别窄化）：`&&` 链的每个操作数是一个
 * filter——单等值守卫（`p.type === 'X'`）为
 * 单值集、`||` 组（`p.type === 'X' ||
 * p.type === 'Y'`）为多值集；非等值操作数
 * 不贡献 filter。臂须匹配所有 filter
 * （&& 语义）。
 */
function collectTypeFilters(
  test: Node,
  paramName: string,
): Array<Set<string>> {
  if (test.type === "LogicalExpression") {
    const t = test as unknown as {
      operator: string;
      left: Node;
      right: Node;
    };
    if (t.operator === "&&") {
      return [
        ...collectTypeFilters(t.left, paramName),
        ...collectTypeFilters(t.right, paramName),
      ];
    }
    if (t.operator === "||") {
      const left = typeEqualityValue(t.left, paramName);
      const right = typeEqualityValue(t.right, paramName);
      if (left !== undefined && right !== undefined) {
        return [new Set([left, right])];
      }
      return [];
    }
    return [];
  }
  const v = typeEqualityValue(test, paramName);
  return v === undefined ? [] : [new Set([v])];
}

/** `p.type === 'lit'` 等值守卫的值（非守卫 → undefined） */
function typeEqualityValue(
  test: Node,
  paramName: string,
): string | undefined {
  if (test.type !== "BinaryExpression") return undefined;
  const t = test as unknown as {
    operator: string;
    left: Node;
    right: Node;
  };
  if (t.operator !== "===") return undefined;
  const m = isParamTypeMember(t.left, paramName)
    ? t.right
    : isParamTypeMember(t.right, paramName)
      ? t.left
      : undefined;
  return m === undefined ? undefined : literalStringValue(m);
}

/** `p.type` 成员访问（p 是参数、property 是 type、非计算非可选） */
function isParamTypeMember(n: Node, paramName: string): boolean {
  if (n.type !== "MemberExpression") return false;
  const m = n as unknown as {
    object: Node;
    property: Node;
    computed?: boolean;
    optional?: boolean;
  };
  if (m.computed === true || m.optional === true) return false;
  if (m.property.type !== "Identifier" || m.property.name !== "type") {
    return false;
  }
  return m.object.type === "Identifier" && m.object.name === paramName;
}

/** 字符串字面量值（`'X'` 或构建器 `lit('X')`——Babel 节点类型为 StringLiteral） */
export function literalStringValue(v: Node): string | undefined {
  if (v.type === "StringLiteral") {
    const lv = (v as unknown as { value: unknown }).value;
    return typeof lv === "string" ? lv : undefined;
  }
  if (v.type === "CallExpression") {
    const c = v as unknown as { callee: Node; arguments: Node[] };
    if (
      c.callee.type === "Identifier" &&
      c.callee.name === "lit" &&
      c.arguments.length === 1
    ) {
      return literalStringValue(c.arguments[0]);
    }
  }
  return undefined;
}

/** 守卫 test 蕴含 paramName 为 nullish：`!p` / `p == null` / `||` 任一 / `&&` 全部 */
function isNullishGuardOn(test: Node, paramName: string): boolean {
  if (
    test.type === "UnaryExpression" &&
    (test as unknown as { operator: string }).operator === "!"
  ) {
    const arg = (test as unknown as { argument: Node }).argument;
    return arg.type === "Identifier" && arg.name === paramName;
  }
  if (
    test.type === "BinaryExpression" &&
    ["===", "=="].includes((test as unknown as { operator: string }).operator)
  ) {
    const t = test as unknown as { left: Node; right: Node };
    return isParamVsNullish(t.left, t.right, paramName) ||
      isParamVsNullish(t.right, t.left, paramName);
  }
  if (test.type === "LogicalExpression") {
    const t = test as unknown as {
      operator: string;
      left: Node;
      right: Node;
    };
    if (t.operator === "||") {
      return isNullishGuardOn(t.left, paramName) || isNullishGuardOn(t.right, paramName);
    }
    if (t.operator === "&&") {
      return isNullishGuardOn(t.left, paramName) && isNullishGuardOn(t.right, paramName);
    }
  }
  return false;
}

function isParamVsNullish(a: Node, b: Node, paramName: string): boolean {
  if (a.type !== "Identifier" || a.name !== paramName) return false;
  if ((b.type as string) === "Literal") {
    return (b as unknown as { value: unknown }).value === null ||
      (b as unknown as { value: unknown }).value === undefined;
  }
  return b.type === "Identifier" && b.name === "undefined";
}

/** then 分支以 return/throw 结束（块看末语句）——早退路径 */
function endsWithReturnThrow(node: Node): boolean {
  if (node.type === "ReturnStatement" || node.type === "ThrowStatement") return true;
  if (node.type === "BlockStatement") {
    const body = (node as unknown as { body: Node[] }).body;
    return body.length > 0 && endsWithReturnThrow(body[body.length - 1]);
  }
  return false;
}

function isParamReassignment(stmt: Node, paramName: string): boolean {
  if (stmt.type !== "ExpressionStatement") return false;
  const expr = (stmt as unknown as { expression: Node }).expression;
  if (expr.type === "AssignmentExpression") {
    const left = (expr as unknown as { left: Node }).left;
    return left.type === "Identifier" && left.name === paramName;
  }
  if (expr.type === "UpdateExpression") {
    const arg = (expr as unknown as { argument: Node }).argument;
    return arg.type === "Identifier" && arg.name === paramName;
  }
  return false;
}
