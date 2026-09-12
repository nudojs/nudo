/**
 * B 路径 transpile：JS AST → 可在 Node 上执行的抽象值程序（源码字符串）。
 * 运算符改为 $add/$sub/…；if 改为 $fork；for 改为 $for。
 * 值类型是 Abs；副作用与模块仍由 host mock/注入。
 */

import type { File, Expression, Statement } from "@babel/types";
import { parseSource } from "../parse-source.ts";

export type TranspileOptions = {
  /** 运行时 import 说明符 */
  runtimeImport?: string;
  maxLoopIters?: number;
};

const BIN_OPS: Record<string, string> = {
  "+": "$add",
  "-": "$sub",
  "*": "$mul",
  "/": "$div",
  "%": "$mod",
  "<": "$lt",
  "<=": "$le",
  ">": "$gt",
  ">=": "$ge",
  "===": "$eq",
  "!==": "$ne",
};

export function transpileSource(source: string, opts: TranspileOptions = {}): string {
  const file = parseSource(source);
  return transpileFile(file, opts);
}

export function transpileFile(file: File, opts: TranspileOptions = {}): string {
  const runtime = opts.runtimeImport ?? "@nudojs/core/exec";
  const lines: string[] = [
    `// nudo B-path transpile — values are Abs; operators are overloaded calls`,
    `import { $add, $sub, $mul, $div, $mod, $neg, $typeof, $not, $eq, $ne, $lt, $le, $gt, $ge, $join, $lit, $fork, $for, $forIter, $obj, $get, $set, $while, $whileSeq } from ${JSON.stringify(runtime)};`,
    ``,
  ];
  for (const stmt of file.program.body) {
    lines.push(transpileStatement(stmt, 0, opts));
  }
  return lines.join("\n") + "\n";
}

function indent(n: number): string {
  return "  ".repeat(n);
}

function transpileStatement(stmt: Statement, depth: number, opts: TranspileOptions): string {
  const pad = indent(depth);
  switch (stmt.type) {
    case "FunctionDeclaration": {
      if (!stmt.id) return `${pad}// <anonymous fn skipped>`;
      const params = stmt.params
        .map((p) => (p.type === "Identifier" ? p.name : "_"))
        .join(", ");
      const body =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, opts)).join("\n")
          : `${indent(depth + 1)}return ${transpileExpression(stmt.body as unknown as Expression, opts)};`;
      return `${pad}export function ${stmt.id.name}(${params}) {\n${body}\n${pad}}`;
    }
    case "ReturnStatement": {
      if (!stmt.argument) return `${pad}return $lit(undefined);`;
      return `${pad}return ${transpileExpression(stmt.argument, opts)};`;
    }
    case "ExpressionStatement":
      return `${pad}${transpileExpression(stmt.expression, opts)};`;
    case "VariableDeclaration": {
      const kw = stmt.kind === "const" ? "const" : "let";
      return stmt.declarations
        .map((d) => {
          if (d.id.type !== "Identifier") return `${pad}// destructure not in MVP`;
          const init = d.init ? transpileExpression(d.init, opts) : "$lit(undefined)";
          return `${pad}${kw} ${d.id.name} = ${init};`;
        })
        .join("\n");
    }
    case "IfStatement": {
      const test = transpileExpression(stmt.test, opts);
      const cons = transpileBlockAsThunk(stmt.consequent, depth, opts);
      const alt = stmt.alternate ? transpileBlockAsThunk(stmt.alternate, depth, opts) : "undefined";
      return `${pad}$fork(${test}, ${cons}, ${alt});`;
    }
    case "ForStatement": {
      const initName = extractForInitName(stmt.init);
      if (!initName) return `${pad}// unsupported for-init; use \`let i = …\``;
      const initExpr =
        stmt.init && stmt.init.type === "VariableDeclaration" && stmt.init.declarations[0]?.init
          ? transpileExpression(stmt.init.declarations[0].init, opts)
          : "$lit(undefined)";
      const testSrc = stmt.test ? transpileExpression(stmt.test, opts) : "$lit(true)";
      const updateSrc = stmt.update ? transpileExpression(stmt.update, opts) : `$lit(undefined)`;
      const bodyStmts =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body
              .map((s) => transpileStatement(s, depth + 2, opts))
              .join("\n")
          : transpileStatement(stmt.body, depth + 2, opts);
      const max = opts.maxLoopIters ?? 8;
      // MVP：经典单变量计数循环（状态 = 计数器 Abs）
      return [
        `${pad}// for → $for (bounded unroll, max=${max})`,
        `${pad}$for(`,
        `${indent(depth + 1)}${initExpr},`,
        `${indent(depth + 1)}(${initName}) => ${testSrc},`,
        `${indent(depth + 1)}(${initName}) => ${updateSrc},`,
        `${indent(depth + 1)}(${initName}) => {`,
        bodyStmts,
        `${indent(depth + 1)}  return ${initName};`,
        `${indent(depth + 1)}},`,
        `${indent(depth + 1)}${max}`,
        `${pad});`,
      ].join("\n");
    }
    case "BlockStatement":
      return stmt.body.map((s) => transpileStatement(s, depth, opts)).join("\n");
    case "WhileStatement": {
      const test = transpileExpression(stmt.test, opts);
      const body =
        stmt.body.type === "BlockStatement"
          ? stmt.body.body.map((s) => transpileStatement(s, depth + 1, opts)).join("\n")
          : transpileStatement(stmt.body, depth + 1, opts);
      const max = opts.maxLoopIters ?? 8;
      // 顺序形态：body 内对 JS let 赋值即状态；抽象条件靠预算
      return [
        `${pad}// while → $whileSeq (bounded, max=${max})`,
        `${pad}$whileSeq(() => ${test}, () => {`,
        body,
        `${pad}}, ${max});`,
      ].join("\n");
    }
    default:
      return `${pad}/* skip ${stmt.type} */`;
  }
}

function transpileBlockAsThunk(stmt: Statement, depth: number, opts: TranspileOptions): string {
  if (stmt.type === "BlockStatement") {
    const inner = stmt.body.map((s) => transpileStatement(s, depth + 1, opts)).join("\n");
    return `() => {\n${inner}\n${indent(depth)}}`;
  }
  if (stmt.type === "ReturnStatement") {
    const v = stmt.argument ? transpileExpression(stmt.argument, opts) : "$lit(undefined)";
    return `() => ${v}`;
  }
  const one = transpileStatement(stmt, depth + 1, opts);
  return `() => {\n${one}\n${indent(depth)}}`;
}

function extractForInitName(init: Statement | Expression | null | undefined): string | null {
  if (!init || init.type !== "VariableDeclaration") return null;
  const d = init.declarations[0];
  return d?.id.type === "Identifier" ? d.id.name : null;
}

export function transpileExpression(expr: Expression, opts: TranspileOptions = {}): string {
  switch (expr.type) {
    case "NumericLiteral":
    case "StringLiteral":
    case "BooleanLiteral":
      return `$lit(${JSON.stringify(expr.value)})`;
    case "NullLiteral":
      return `$lit(null)`;
    case "Identifier":
      if (expr.name === "undefined") return "$lit(undefined)";
      return expr.name;
    case "LogicalExpression": {
      const op = expr.operator;
      const l = transpileExpression(expr.left, opts);
      const r = transpileExpression(expr.right, opts);
      return op === "&&"
        ? `$fork(${l}, () => ${r}, () => ${l})`
        : `$fork(${l}, () => ${l}, () => ${r})`;
    }
    case "BinaryExpression": {
      const fn = BIN_OPS[expr.operator];
      if (!fn) return `/* unsupported ${expr.operator} */ $lit(undefined)`;
      const l = isExpression(expr.left) ? transpileExpression(expr.left, opts) : "$lit(undefined)";
      const r = isExpression(expr.right) ? transpileExpression(expr.right, opts) : "$lit(undefined)";
      return `${fn}(${l}, ${r})`;
    }
    case "UnaryExpression": {
      const arg = transpileExpression(expr.argument as Expression, opts);
      if (expr.operator === "-") return `$neg(${arg})`;
      if (expr.operator === "!") return `$not(${arg})`;
      if (expr.operator === "typeof") return `$typeof(${arg})`;
      if (expr.operator === "+") return arg;
      return `/* unary ${expr.operator} */ $lit(undefined)`;
    }
    case "SequenceExpression":
      return expr.expressions.map((e) => transpileExpression(e, opts)).join(", ");
    case "ObjectExpression": {
      const parts: string[] = [];
      for (const prop of expr.properties) {
        if (prop.type !== "ObjectProperty") continue;
        const key =
          prop.key.type === "Identifier"
            ? JSON.stringify(prop.key.name)
            : prop.key.type === "StringLiteral"
              ? JSON.stringify(prop.key.value)
              : null;
        if (key === null) continue;
        if (prop.computed) continue;
        const valSrc = transpileExpression(prop.value as Expression, opts);
        parts.push(`${key}: ${valSrc}`);
      }
      return `$obj({ ${parts.join(", ")} })`;
    }
    case "MemberExpression": {
      if (expr.computed) {
        // o[k] 仅支持字面量 key 的 MVP
        const key = expr.property;
        if (key.type === "StringLiteral" || key.type === "NumericLiteral") {
          return `$get(${transpileExpression(expr.object as Expression, opts)}, ${JSON.stringify(String(key.value))})`;
        }
        return `/* computed member */ $lit(undefined)`;
      }
      if (expr.property.type !== "Identifier") {
        return `/* member */ $lit(undefined)`;
      }
      return `$get(${transpileExpression(expr.object as Expression, opts)}, ${JSON.stringify(expr.property.name)})`;
    }
    case "AssignmentExpression": {
      // obj.field = v → $set；标识符赋值保持 JS 绑定（值是 Abs）
      if (expr.operator !== "=") return `/* assign ${expr.operator} */ $lit(undefined)`;
      const right = transpileExpression(expr.right, opts);
      if (
        expr.left.type === "MemberExpression" &&
        !expr.left.computed &&
        expr.left.property.type === "Identifier"
      ) {
        const obj = transpileExpression(expr.left.object as Expression, opts);
        return `$set(${obj}, ${JSON.stringify(expr.left.property.name)}, ${right})`;
      }
      if (expr.left.type === "Identifier") {
        return `${expr.left.name} = ${right}`;
      }
      return `/* assign */ $lit(undefined)`;
    }
    case "CallExpression": {
      const callee = expr.callee;
      const args = expr.arguments
        .map((a) =>
          a.type === "SpreadElement" ? `/* spread */` : transpileExpression(a as Expression, opts),
        )
        .join(", ");
      const c =
        callee.type === "Identifier"
          ? callee.name
          : isExpression(callee)
            ? transpileExpression(callee, opts)
            : "/* callee */";
      return `${c}(${args})`;
    }
    default:
      return `/* ${expr.type} */ $lit(undefined)`;
  }
}

/** 解析 + transpile */
export function transpile(source: string, opts?: TranspileOptions): string {
  return transpileSource(source, opts);
}

function isExpression(n: { type: string }): n is Expression {
  return n.type !== "PrivateName" && !n.type.endsWith("Statement") && !n.type.endsWith("Declaration");
}
