/**
 * Bug 1071 —— `strip-types` 把构造器参数属性赋值插到 `super()` **之前** ⇒
 * `migrate strip` 产出**运行期即抛**的 `.js`。
 *
 * 触发：派生类 + 构造器参数属性
 * ```ts
 * export class Base {}
 * export class Point extends Base {
 *   constructor(private x: number) { super(); }
 * }
 * ```
 * 改前产物：`constructor(x) {this.x = x;super();}` ⇒ `new Point(1)` 实跑 ⇒
 * `ReferenceError: Must call super constructor in derived class before
 * accessing 'this' or returning from derived constructor`。
 *
 * 对照 tsc emit（同输入，`tsc --target es2022`）：`super(); this.x = x;`
 * （赋值在 super **之后**）⇒ 本文件按 tsc 口径对齐。
 *
 * 危害：`migrate` 是**一程闸门**（无回退路径）⇒ 写出的产物运行期直接崩；
 * `node --check` 只验语法（`this.x = x; super();` 语法合法）⇒ 兜底闸门放行。
 *
 * 修法：派生类的参数属性赋值落 `super(...)` **之后**；非派生类仍在构造器体
 * 开头（行为不变）。
 */
import { describe, it, expect } from "vitest";
import { parseSource, stripTypes } from "../index.ts";

type Stmt = { type?: string; expression?: Expr };
type Expr = {
  type?: string;
  name?: string;
  value?: unknown;
  callee?: Expr;
  arguments?: Expr[];
  object?: Expr;
  property?: Expr;
  computed?: boolean;
  operator?: string;
  left?: Expr;
  right?: Expr;
};

/** 剥除后的构造器体语句（按 AST 顺序） */
function ctorStmts(src: string, clsName: string): { params: string[]; stmts: Stmt[] } {
  const ast = parseSource(src, { keepTs: true });
  stripTypes(ast, src);
  const body = (ast as { program: { body: unknown[] } }).program.body;
  const decl = body
    .map((n) => (n as { declaration?: unknown }).declaration ?? n)
    .find((n) => {
      const d = n as { type?: string; id?: { name?: string } };
      return d?.type === "ClassDeclaration" && d.id?.name === clsName;
    }) as {
    body: { body: { kind?: string; params: { name?: string }[]; body: { body: Stmt[] } }[] };
  };
  const ctor = decl.body.body.find((m) => m.kind === "constructor");
  if (!ctor) throw new Error(`no constructor for ${clsName}`);
  return {
    params: ctor.params.map((p) => p.name ?? ""),
    stmts: ctor.body.body,
  };
}

/** 语句的粗粒度形态（用于断言顺序） */
function shape(stmt: Stmt): string {
  const e = stmt.expression;
  if (!e) return stmt.type ?? "?";
  if (e.type === "CallExpression" && e.callee?.type === "Super") return "super";
  if (e.type === "AssignmentExpression") return `assign:${exprJs(e.left ?? {})}`;
  return e.type ?? "?";
}

/**
 * 剥除后的构造器体 → JS 文本。
 *
 * 只认本文件用例涉及的形态（`super(...)` 调用 / `this.x = x` 赋值 / 数字
 * 字面量）；遇到未知形态**直接抛** ⇒ 不会把「印不出来」静默当成「印对了」。
 */
function stmtJs(stmt: Stmt): string {
  const e = stmt.expression;
  if (stmt.type !== "ExpressionStatement" || !e) {
    throw new Error(`unsupported stmt: ${stmt.type}`);
  }
  if (e.type === "CallExpression" && e.callee?.type === "Super") {
    return `super(${(e.arguments ?? []).map(exprJs).join(", ")});`;
  }
  if (e.type === "AssignmentExpression") {
    return `${exprJs(e.left ?? {})} = ${exprJs(e.right ?? {})};`;
  }
  throw new Error(`unsupported expr: ${e.type}`);
}

function exprJs(node: Expr): string {
  switch (node.type) {
    case "Identifier":
      return node.name ?? "";
    case "ThisExpression":
      return "this";
    case "NumericLiteral":
    case "StringLiteral":
      return JSON.stringify(node.value);
    case "MemberExpression":
      if (node.computed) throw new Error("computed member unsupported");
      return `${exprJs(node.object ?? {})}.${node.property?.name ?? ""}`;
    default:
      throw new Error(`unsupported node: ${node.type}`);
  }
}

/** 真跑一遍：派生类壳（Base/Point）⇒ 返回 `new Point(1)` 的实例 */
function runDerived(params: string[], stmts: Stmt[]): { x: unknown } {
  const body = stmts.map(stmtJs).join("\n");
  const src = `class Base {}
class Point extends Base {
  constructor(${params.join(", ")}) {
${body}
  }
}
return new Point(1);`;
  return new Function(src)() as { x: unknown };
}

/** 真跑一遍：基类壳（Plain）⇒ 返回 `new Plain(1)` 的实例 */
function runBase(params: string[], stmts: Stmt[]): { z: unknown } {
  const body = stmts.map(stmtJs).join("\n");
  const src = `class Plain {
  constructor(${params.join(", ")}) {
${body}
  }
}
return new Plain(1);`;
  return new Function(src)() as { z: unknown };
}

const derivedSrc = `export class Base {}
export class Point extends Base {
  constructor(private x: number) { super(); }
}
`;

describe("Bug 1071：派生类的构造器参数属性赋值必须落在 super(...) 之后", () => {
  it("派生类：赋值在 super(...) 之后（改前：super 在后 ⇒ ReferenceError）", () => {
    const { params, stmts } = ctorStmts(derivedSrc, "Point");
    expect(params).toEqual(["x"]);
    expect(stmts.map(shape)).toEqual(["super", "assign:this.x"]);
  });

  it("派生类：`new Point(1)` 不抛 ReferenceError 且字段已赋值", () => {
    const { params, stmts } = ctorStmts(derivedSrc, "Point");
    const inst = runDerived(params, stmts);
    expect(inst.x).toBe(1);
  });

  it("派生类：super(...) 之后的其它语句仍在赋值之后（tsc emit 口径）", () => {
    const src = `export class Base {}
export class Point extends Base {
  constructor(private x: number) {
    super();
    this.extra = 2;
  }
}
`;
    const { stmts } = ctorStmts(src, "Point");
    expect(stmts.map(shape)).toEqual(["super", "assign:this.x", "assign:this.extra"]);
  });

  it("非派生类：行为不变（赋值仍在构造器体开头）", () => {
    const src = `export class Plain {
  constructor(private z: number) { this.z = z; }
}
`;
    const { params, stmts } = ctorStmts(src, "Plain");
    expect(params).toEqual(["z"]);
    expect(stmts.map(shape)).toEqual(["assign:this.z", "assign:this.z"]);
    expect(runBase(params, stmts).z).toBe(1);
  });

  it("派生类构造器体顶层没有 super(...) ⇒ 保守不改相对顺序 + 回报事实", () => {
    const src = `export class Base {}
export class Point extends Base {
  constructor(private x: number) { }
}
`;
    const report: { ctorParamPropsSuperMissing?: boolean } = {};
    const ast = parseSource(src, { keepTs: true });
    stripTypes(ast, src, { report });
    const decl = (ast as { program: { body: unknown[] } }).program.body
      .map((n) => (n as { declaration?: unknown }).declaration ?? n)
      .find((n) => (n as { id?: { name?: string } })?.id?.name === "Point") as {
      body: { body: { kind?: string; body: { body: Stmt[] } }[] };
    };
    const ctor = decl.body.body.find((m) => m.kind === "constructor");
    expect(ctor?.body.body.map(shape)).toEqual(["assign:this.x"]);
    expect(report.ctorParamPropsSuperMissing).toBe(true);
  });
});
