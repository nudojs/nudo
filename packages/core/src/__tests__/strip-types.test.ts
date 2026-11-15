/**
 * 模块套件：TypeScript strip 面（enum/装饰器/类型导入/参数属性/注释携带）。
 */
import { describe, it, expect } from "vitest";
import { parseSource, stripTypes } from "../index.ts";
import { stripTypes as stripTypes_____strip_types_ts } from "../strip-types.ts";
import { call } from "../algebra/__tests__/eval-helpers.ts";
import { litValue } from "../algebra/abs.ts";

// ---------------------------------------------------------------------------
// Bug 1071：派生类的构造器参数属性赋值必须落在 super(...) 之后
// ---------------------------------------------------------------------------
describe("[core--strip] Bug 1071：派生类的构造器参数属性赋值必须落在 super(...) 之后", () => {
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
});

// ---------------------------------------------------------------------------
// Bug 234: enum 计算成员里的成员引用必须改写成 E["KEY"]
// ---------------------------------------------------------------------------
describe("[core--strip] Bug 234: enum 计算成员里的成员引用必须改写成 E[\"KEY\"]", () => {
/**
 * BUG-234 —— TS enum 的**计算成员**原样保留初始化表达式（不把成员引用改写成
 * `E["A"]`）⇒ strip 产物引用**未绑定全局** ⇒ 运行时 ReferenceError。
 *
 * 根因：`strip-types.ts` 的 `synthesizeEnum` 对计算成员只做
 * `transformValue(init)` 就抄进 IIFE ⇒ `B = A * 10` 里的 `A` 保持裸标识符。
 * 而 tsc 的 emit 会把成员引用改写成 `E["A"]`（常量可折叠时进一步折叠）。
 *
 * 本文件钉**合成 AST 的运行期形态**（不是源码文本）：
 * - 计算成员的初始化表达式里，成员引用必须是 `E["KEY"]`（MemberExpression）；
 * - 同一函数里自动递增成员（`C`）本来就用 `E["B"] + 1` —— 两种口径必须一致；
 * - 字符串值的计算成员**不**建反向映射（tsc 口径）。
 *
 * 反向闸：把 `rewriteEnumMemberRefs` 去掉 ⇒ 第 1/2 条的 `E["A"]` 断言必红。
 */




/** `enum E { … }` 的合成 IIFE 语句数组（`export enum` 也接受） */
function enumStmts(src: string): Array<Record<string, unknown>> {
  const ast = parseSource(src, { keepTs: true });
  const report: Record<string, unknown> = {};
  stripTypes_____strip_types_ts(ast, undefined, { report });
  const program = ast.program as unknown as { body: Array<Record<string, unknown>> };
  const first = program.body[0]!;
  const decl = (first.type === "ExportNamedDeclaration" ? first.declaration : first) as Record<
    string,
    unknown
  >;
  expect(decl.type).toBe("VariableDeclaration");
  const declarations = decl.declarations as Array<Record<string, unknown>>;
  const init = declarations[0]!.init as Record<string, unknown>;
  expect(init.type).toBe("CallExpression");
  const callee = init.callee as Record<string, unknown>;
  const fnBody = callee.body as { body: Array<Record<string, unknown>> };
  // 最后一条是 `return E`
  return fnBody.body.slice(0, -1).map((s) => {
    const statement = s as Record<string, unknown>;
    return statement.expression as Record<string, unknown>;
  });
}

/** `E[E["KEY"] = <value>] = "KEY"` → 取 `<value>`；字符串成员取右侧 */
function assignedValue(expr: Record<string, unknown>): Record<string, unknown> {
  const left = expr.left as Record<string, unknown>;
  // 数值成员：left = MemberExpression{ object: E, property: AssignmentExpression }
  if (left.type === "MemberExpression") {
    const inner = left.property as Record<string, unknown>;
    expect(inner.type).toBe("AssignmentExpression");
    return inner.right as Record<string, unknown>;
  }
  // 字符串成员：left = MemberExpression{ object: E, property: "KEY" }
  return expr.right as Record<string, unknown>;
}

/** 初始化表达式里出现的裸标识符名（引用位置；排除被改写后的 MemberExpression） */
function bareIdentifiers(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  const rec = node as Record<string, unknown>;
  if (rec.type === "Identifier" && typeof rec.name === "string") {
    out.push(rec.name);
    return out;
  }
  for (const key of Object.keys(rec)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra") continue;
    const child = rec[key];
    if (child && typeof child === "object") bareIdentifiers(child, out);
  }
  return out;
}

describe("Bug 234: enum 计算成员里的成员引用必须改写成 E[\"KEY\"]", () => {
  it("数值 enum：`B = A * 10` 的 A 变成 E[\"A\"]（不再是未绑定全局）", () => {
    const stmts = enumStmts(`export enum E { A = 1, B = A * 10, C }`);
    const b = assignedValue(stmts[1]!);
    expect(b.type).toBe("BinaryExpression");
    const left = b.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    expect(left.computed).toBe(true);
    expect((left.object as { name?: string }).name).toBe("E");
    expect((left.property as { value?: string }).value).toBe("A");
    // 反向闸：产物里不得再有裸 `A`（正是运行期 ReferenceError 的来源）
    expect(bareIdentifiers(b)).not.toContain("A");
  });

  it("同一 enum 的自动递增成员仍用 E[\"B\"] + 1（两种口径一致）", () => {
    const stmts = enumStmts(`export enum E { A = 1, B = A * 10, C }`);
    const c = assignedValue(stmts[2]!);
    expect(c.type).toBe("BinaryExpression");
    expect((c.operator as string)).toBe("+");
    const left = c.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    expect((left.property as { value?: string }).value).toBe("B");
  });

  it("混合 enum：`C = A + 5` 的 A 也改写成 E[\"A\"]", () => {
    const stmts = enumStmts(`export enum E { A = 1, B = 'b', C = A + 5 }`);
    const c = assignedValue(stmts[2]!);
    const left = c.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    expect((left.property as { value?: string }).value).toBe("A");
    expect(bareIdentifiers(c)).not.toContain("A");
  });

  it("字符串 enum：`B = A + 'b'` 的 A 改写成 E[\"A\"]，且**不**建反向映射", () => {
    const stmts = enumStmts(`export enum E { A = 'a', B = A + 'b' }`);
    const expr = stmts[1]!;
    // 字符串成员：`E["B"] = …`（left 是 MemberExpression，property 不是赋值）
    const left = expr.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    const prop = left.property as Record<string, unknown>;
    expect(prop.type).toBe("StringLiteral");
    expect(prop.value).toBe("B");
    // 右侧的 A 已改写成 E["A"]
    const right = expr.right as Record<string, unknown>;
    const rightLeft = right.left as Record<string, unknown>;
    expect(rightLeft.type).toBe("MemberExpression");
    expect((rightLeft.property as { value?: string }).value).toBe("A");
    expect(bareIdentifiers(right)).not.toContain("A");
  });

  it("const enum：`B = A * 3` 同样改写成 E[\"A\"]", () => {
    const stmts = enumStmts(`export const enum E { A = 1, B = A * 3 }`);
    const b = assignedValue(stmts[1]!);
    const left = b.left as Record<string, unknown>;
    expect(left.type).toBe("MemberExpression");
    expect((left.property as { value?: string }).value).toBe("A");
  });

  it("剥除事实回报：enumComputedMemberRewritten 只在有计算成员时为真", () => {
    const plain: Record<string, unknown> = {};
    stripTypes_____strip_types_ts(parseSource(`export enum E { A = 1, B }`, { keepTs: true }), undefined, {
      report: plain,
    });
    expect(plain.enumComputedMemberRewritten).toBeUndefined();

    const computed: Record<string, unknown> = {};
    stripTypes_____strip_types_ts(parseSource(`export enum E { A = 1, B = A * 2 }`, { keepTs: true }), undefined, {
      report: computed,
    });
    expect(computed.enumComputedMemberRewritten).toBe(true);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 445: 值位置的类型专用导入被消掉（tsc import elision 同口径）
// ---------------------------------------------------------------------------
describe("[core--strip] Bug 445: 值位置的类型专用导入被消掉（tsc import elision 同口径）", () => {
/**
 * Bug 445 —— 值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。
 *
 * 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === "type"），
 * 不看「绑定是否只在类型位置被使用」。tsc 的 import elision 会把只用在类型
 * 位置的具名 import **消掉**；不消掉的话，被 import 的模块被剥成空模块 ⇒
 * 产物 ESM 链接期 SyntaxError（"does not provide an export named 'Foo'"）。
 *
 * 修法：语法级的「值位置引用收集」（collectValueReferences）⇒ 值位置零引用
 * 的绑定按 tsc 口径消掉；判不准的一律**保留**（保守）。
 */



const body = (src: string) => parseSource(src).program.body;
const imports = (src: string) =>
  body(src).filter((n) => n.type === "ImportDeclaration") as unknown as {
    specifiers: { local: { name: string } }[];
  }[];

describe("Bug 445: 值位置的类型专用导入被消掉（tsc import elision 同口径）", () => {
  it("绑定只在类型位置被用到 ⇒ 整条 import 消失（产物可加载）", () => {
    expect(
      imports(`import { Foo } from "./types.js";\nexport function use(f: Foo): string { return "ok"; }`),
    ).toHaveLength(0);
  });

  it("绑定在值位置被用到 ⇒ import 保留", () => {
    const kept = imports(
      `import { val } from "./types.js";\nexport function use(): number { return val; }`,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].specifiers.map((s) => s.local.name)).toEqual(["val"]);
  });

  it("混用：type specifier 被剔除、值 specifier 保留", () => {
    const kept = imports(`import { type A, b } from "m";\nexport function u() { return b; }`);
    expect(kept).toHaveLength(1);
    expect(kept[0].specifiers.map((s) => s.local.name)).toEqual(["b"]);
  });

  it("显式 import type 整条删除（既有行为）", () => {
    expect(imports(`import type { A } from "m";\nexport const x = 1;`)).toHaveLength(0);
  });

  it("裸 import（副作用）保留", () => {
    expect(imports(`import "./side.js";\nexport const x = 1;`)).toHaveLength(1);
  });

  it("typeof 类型查询是类型位置 ⇒ import 同样被消掉（tsc 同口径）", () => {
    expect(imports(`import { val } from "./m.js";\nexport type T = typeof val;`)).toHaveLength(0);
  });

  it("本地再导出（export { X }）判不准 ⇒ 保守保留 import", () => {
    expect(imports(`import { Foo } from "./m.js";\nexport { Foo };`)).toHaveLength(1);
  });

  it("export { X } from \"m\" 的 X 是源模块的绑定 ⇒ 本地 import 判为「没被引用」⇒ 保守保留", () => {
    // 保守口径：绑定**根本没被引用**（既不在值位置也不在类型位置）的本地 import
    // **保留**（tsc 会消掉它，但那是「产物更干净」而不是「产物可用」）。
    expect(imports(`import { Foo } from "./m.js";\nexport { Foo } from "./other.js";`)).toHaveLength(1);
  });

  it("包说明符的 import 一律保留（nudo 不剥除包 ⇒ 不动）", () => {
    expect(imports(`import { Foo } from "some-pkg";\nexport function use(f: Foo) { return f; }`)).toHaveLength(1);
  });

  it("类 heritage 的基类是值引用 ⇒ import 保留", () => {
    expect(
      imports(`import { Base } from "./m.js";\nexport class C extends Base {}`),
    ).toHaveLength(1);
  });

  it("接口的 extends 是类型位置 ⇒ import 被消掉（tsc 同口径）", () => {
    expect(imports(`import { Base } from "./m.js";\nexport interface I extends Base {}`)).toHaveLength(
      0,
    );
  });
});
});

// ---------------------------------------------------------------------------
// Bug 446: TS-only 的模块出口语句被剥除
// ---------------------------------------------------------------------------
describe("[core--strip] Bug 446: TS-only 的模块出口语句被剥除", () => {
/**
 * Bug 446 —— TS-only 的 `export =` / `export as namespace` 未剥 ⇒ 产物不是合法 JS。
 *
 * 根因：strip-types.ts 的 `isTypeOnlyStatement` 语句级 switch 缺
 * `TSExportAssignment` / `TSNamespaceExportDeclaration` 两个 case ⇒ 这两条
 * TS-only 语句被原样打印进 `.js` ⇒ `node --check` ⇒ SyntaxError。
 *
 * 修法：switch 补这两个 case（两条语句被剥除）。
 */



const body = (src: string) => parseSource(src).program.body;

describe("Bug 446: TS-only 的模块出口语句被剥除", () => {
  it("export = X（TSExportAssignment）整条删除", () => {
    const b = body(`declare namespace N { const x: number; }\nexport = N;`);
    expect(b.map((n) => n.type)).not.toContain("TSExportAssignment");
    expect(b.some((n) => n.type === "TSExportAssignment")).toBe(false);
  });

  it("export as namespace X（TSNamespaceExportDeclaration）整条删除", () => {
    const b = body(`export as namespace MyGlobal;\nexport declare const v: number;`);
    expect(b.some((n) => n.type === "TSNamespaceExportDeclaration")).toBe(false);
  });

  it("export = 的右值（值引用）不产生残留语句", () => {
    const b = body(`const N = { x: 1 };\nexport = N;`);
    expect(b.map((n) => n.type)).toEqual(["VariableDeclaration"]);
  });

  it("纯 JS 源码不受影响（结构性 no-op）", () => {
    const b = body(`export const x = 1;\nexport default x;`);
    expect(b.map((n) => n.type)).toEqual(["ExportNamedDeclaration", "ExportDefaultDeclaration"]);
  });
});
});

// ---------------------------------------------------------------------------
// Bug 447: 类成员的 definite / optional 被剥除
// ---------------------------------------------------------------------------
describe("[core--strip] Bug 447: 类成员的 definite / optional 被剥除", () => {
/**
 * Bug 447 —— 类成员的 `x!`（确定赋值断言）/ `y?`（可选属性）/ `m?()`（可选方法）
 * 未剥 ⇒ 产物不是合法 JS（`node --check` ⇒ SyntaxError: Unexpected token '!' / '?'）。
 *
 * 根因：strip-types.ts 的 `deleteTypeSyntaxFields` 里
 * - `definite`（Babel 的 ClassProperty.definite）**根本没有**删除逻辑；
 * - `optional` 的删除白名单只有 Identifier / ObjectPattern / ArrayPattern /
 *   RestElement —— **不含类成员节点**。
 *
 * 修法：两个字段都在「只在类成员节点族上删」的块里删（与 accessibility /
 * readonly / abstract / override / declare 同块）。⚠ 表达式节点自己的
 * `optional`（`a?.b`）不是 TS 语法，不能动。
 */



type Member = Record<string, unknown> & { type: string; key?: { name?: string } };

const classMembers = (src: string): Member[] => {
  const decl = parseSource(src).program.body.find(
    (n) => n.type === "ExportNamedDeclaration",
  ) as unknown as { declaration?: { body?: { body?: Member[] } } };
  return decl?.declaration?.body?.body ?? [];
};

describe("Bug 447: 类成员的 definite / optional 被剥除", () => {
  it("x!: number 的 definite 被删", () => {
    const members = classMembers(`export class A { x!: number; }`);
    expect(members).toHaveLength(1);
    expect(members[0].definite).toBeUndefined();
    expect("definite" in members[0]).toBe(false);
  });

  it("y?: string 的 optional 被删", () => {
    const members = classMembers(`export class A { y?: string; }`);
    expect(members[0].optional).toBeUndefined();
    expect("optional" in members[0]).toBe(false);
  });

  it("m?(): void {} 的 optional 被删（ClassMethod 同块）", () => {
    const members = classMembers(`export class A { m?(): void {} }`);
    expect(members[0].type).toBe("ClassMethod");
    expect(members[0].optional).toBeUndefined();
    expect("optional" in members[0]).toBe(false);
  });

  it("私有成员同理（#x! / #y?）", () => {
    const members = classMembers(`export class A { #x!: number; #y?: string; }`);
    for (const m of members) {
      expect(m.definite).toBeUndefined();
      expect(m.optional).toBeUndefined();
    }
  });

  it("表达式节点的 optional（a?.b）不受影响", () => {
    const decl = parseSource(`export const v = a?.b;`).program.body[0] as unknown as {
      declaration?: { declarations?: { init?: { type?: string; optional?: unknown } }[] };
    };
    const init = decl?.declaration?.declarations?.[0]?.init;
    expect(init?.type).toBe("OptionalMemberExpression");
    expect(init?.optional).toBe(true);
  });

  it("形参的 optional（a?: T）仍被删（既有行为）", () => {
    const decl = parseSource(`export function f(a?: number) { return a; }`).program.body[0] as unknown as {
      declaration?: { params?: { optional?: unknown }[] };
    };
    expect(decl?.declaration?.params?.[0].optional).toBeUndefined();
  });
});
});

// ---------------------------------------------------------------------------
// Bug 448: TS 的 this 形参从形参数组里删除
// ---------------------------------------------------------------------------
describe("[core--strip] Bug 448: TS 的 this 形参从形参数组里删除", () => {
/**
 * Bug 448 —— TS 的 `this` 形参未剥 ⇒ 产物 `function f(this, a)` Node 加载不了。
 *
 * 根因：Babel 把 TS 的 `this` 形参表示成**一个名叫 `this` 的 `Identifier`**，
 * 而 strip-types.ts 的 `deleteTypeSyntaxFields` 只删它的 `typeAnnotation`
 * ⇒ 打印出来是 `function f(this, a)`；`this` 不是合法形参名（strict 与 sloppy
 * 都不允许）⇒ 产物不是合法 JS。
 *
 * 修法：把 `this` 形参从**形参数组**里删掉（不是只删 typeAnnotation），
 * 与 tsc 的 emitter 同口径。
 */



type Fn = { params?: { type?: string; name?: string }[]; body?: { body?: { type: string; argument?: { type: string } }[] } };

/** 取源码里第一个函数（声明或表达式）的节点 */
const fnOf = (src: string): Fn => {
  const decl = parseSource(src).program.body[0] as unknown as {
    declaration?: Fn & { declarations?: { init?: Fn }[] };
  };
  const d = decl?.declaration;
  if (d?.params) return d;
  return d?.declarations?.[0]?.init ?? {};
};

describe("Bug 448: TS 的 this 形参从形参数组里删除", () => {
  it("function f(this: T, a) ⇒ 只剩 a", () => {
    const fn = fnOf(`export function f(this: { x: number }, a: number): number { return a + 1; }`);
    expect(fn.params?.map((p) => p.name)).toEqual(["a"]);
  });

  it("this 是唯一的形参 ⇒ 形参表为空", () => {
    const fn = fnOf(`export function f(this: { x: number }): number { return 1; }`);
    expect(fn.params).toEqual([]);
  });

  it("函数表达式同理", () => {
    const fn = fnOf(`export const f = function (this: { x: number }, a: number) { return a; };`);
    expect(fn.params?.map((p) => p.name)).toEqual(["a"]);
  });

  it("普通形参不受影响（this 之外的名字保留）", () => {
    const fn = fnOf(`export function f(a: number, b: string) { return a; }`);
    expect(fn.params?.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("函数体里的 this 表达式保留（只有形参位删）", () => {
    const src = `export function f(this: { x: number }) { return this.x; }`;
    const fn = fnOf(src);
    const stmt = fn.body?.body?.[0];
    expect(stmt?.type).toBe("ReturnStatement");
    expect(stmt?.argument?.type).toBe("MemberExpression");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 913: TS enum 被合成成运行时对象
// ---------------------------------------------------------------------------
describe("[core--strip] Bug 913: TS enum 被合成成运行时对象", () => {
/**
 * Bug 913 —— TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒
 * 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard
 * 四个产物面把返回类型落成 `never`。
 *
 * 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条
 * 删除 ⇒ 模块里不再有 `E` 这个绑定。
 *
 * 修法：在 strip-types.ts 内**合成 enum 运行时对象**（路线 a）——逐形态对齐
 * tsc 的 emit：反向映射 / 自动递增 / 字符串枚举（无反向映射）/ const enum
 * （对齐 tsc 的 `--preserveConstEnums` 形态）。
 */





const body = (src: string) => parseSource(src).program.body;

describe("Bug 913: TS enum 被合成成运行时对象", () => {
  it("enum 声明不再被删除 ⇒ 变成一个 var 声明", () => {
    const b = body(`export enum E { A = 1 }`);
    expect(b.map((n) => n.type)).not.toContain("TSEnumDeclaration");
    const decl = b[0] as unknown as {
      type: string;
      declaration?: { type: string; kind?: string; declarations?: { id?: { name?: string } }[] };
    };
    expect(decl.type).toBe("ExportNamedDeclaration");
    expect(decl.declaration?.type).toBe("VariableDeclaration");
    expect(decl.declaration?.kind).toBe("var");
    expect(decl.declaration?.declarations?.[0].id?.name).toBe("E");
  });

  it("成员引用可求值 ⇒ f() => 1（不再是 never / ReferenceError）", () => {
    const rec = call(`export enum E { A = 1 }\nexport function f() { return E.A; }`);
    expect(litValue(rec.result)).toEqual({ ok: true, value: 1 });
  });

  it("反向映射可求值（E[1] === \"A\"）", () => {
    const rec = call(
      `export enum E { A = 1 }\nexport function f() { return E[1]; }`,
    );
    expect(litValue(rec.result)).toEqual({ ok: true, value: "A" });
  });

  it("自动递增（A=1 ⇒ B=2 ⇒ C=3）", () => {
    const rec = call(`export enum E { A = 1, B, C }\nexport function f() { return E.C; }`);
    expect(litValue(rec.result)).toEqual({ ok: true, value: 3 });
  });

  it("字符串枚举：值正确、无反向映射（E[\"a\"] 不存在）", () => {
    const rec = call(`export enum S { A = "a" }\nexport function f() { return S.A; }`);
    expect(litValue(rec.result)).toEqual({ ok: true, value: "a" });
    const rev = call(`export enum S { A = "a" }\nexport function f() { return S["a"]; }`);
    expect(litValue(rev.result)).not.toEqual({ ok: true, value: "A" });
  });

  it("混合枚举：数值成员有反向映射、字符串成员没有", () => {
    const num = call(`export enum M { A = 1, B = "b" }\nexport function f() { return M[1]; }`);
    expect(litValue(num.result)).toEqual({ ok: true, value: "A" });
    const str = call(`export enum M { A = 1, B = "b" }\nexport function f() { return M["b"]; }`);
    expect(litValue(str.result)).not.toEqual({ ok: true, value: "B" });
  });

  it("declare enum（环境声明）仍然整条删除", () => {
    const b = body(`declare enum DE { A = 1 }\nexport const x = 1;`);
    expect(b.map((n) => n.type)).not.toContain("TSEnumDeclaration");
    expect(b).toHaveLength(1);
  });

  it("enum 声明上的文件级指令随合成节点一起活下来（Bug 968 联动）", () => {
    const b = body(
      `/// @nudo:import { positive } from "./shapes.nudo.js"\nexport enum E { A = 1 }`,
    );
    const decl = b[0] as unknown as { leadingComments?: { value: string }[] };
    expect(decl.leadingComments?.[0]?.value).toContain("@nudo:import");
  });
});
});

// ---------------------------------------------------------------------------
// Bug 968: 被删语句上的文件级指令被转挂到幸存节点
// ---------------------------------------------------------------------------
describe("[core--strip] Bug 968: 被删语句上的文件级指令被转挂到幸存节点", () => {
/**
 * Bug 968 —— 挂在「将被删除的语句」上的文件级指令被静默丢掉 ⇒ 门禁红 → 绿
 * （假绿）。
 *
 * 根因：Babel 把文件级 `///` 指令挂成**下一条语句**的 `leadingComments`；strip
 * 的数组分支只删节点、**不搬运注释**，而 `SKIP_KEYS` 又让 pass 根本不进注释
 * 键 ⇒ 凡是挂在将被删除的语句上的指令都随该语句一起从产物里消失。
 *
 * 修法：在 `transformValue` 的数组分支里剔除 REMOVE 元素时把它的
 * `leadingComments` **转挂**到下一个幸存节点；并加「剥除前后指令条数比对」的
 * 兜底自检（report.directivesBefore / directivesAfter / directivesDropped）。
 */



type Report = {
  directivesBefore?: number;
  directivesAfter?: number;
  directivesDropped?: boolean;
};

/** 剥除（keepTs 解析 ⇒ 自己调 stripTypes ⇒ 能拿到 report） */
const stripped = (src: string) => {
  const ast = parseSource(src, { keepTs: true });
  const report: Report = {};
  stripTypes(ast as never, src, { report });
  return { ast, report };
};

const leadingTexts = (node: unknown): string[] => {
  const rec = node as { leadingComments?: { value?: string }[] };
  return (rec.leadingComments ?? []).map((c) => c.value ?? "");
};

describe("Bug 968: 被删语句上的文件级指令被转挂到幸存节点", () => {
  it("指令挂在被删的 import type 上 ⇒ 转挂给下一个幸存语句", () => {
    const { ast } = stripped(
      `/// @nudo:import { positive } from "./shapes.nudo.js"\n` +
        `import type { Foo } from "./types.js";\n` +
        `export function inc(x) { return x + 1; }`,
    );
    const b = ast.program.body;
    expect(b).toHaveLength(1);
    expect(leadingTexts(b[0]).join("\n")).toContain("@nudo:import");
  });

  it("指令在幸存语句上（对照）⇒ 位置不变", () => {
    const { ast } = stripped(
      `import type { Foo } from "./types.js";\n` +
        `/// @nudo:import { positive } from "./shapes.nudo.js"\n` +
        `export function inc(x) { return x + 1; }`,
    );
    const b = ast.program.body;
    expect(leadingTexts(b[0]).join("\n")).toContain("@nudo:import");
  });

  it("剥除前后指令条数一致（兜底自检：directivesBefore === directivesAfter）", () => {
    const { report } = stripped(
      `/// @nudo:import { positive } from "./shapes.nudo.js"\n` +
        `import type { Foo } from "./types.js";\n` +
        `export function inc(x) { return x + 1; }`,
    );
    expect(report.directivesBefore).toBe(1);
    expect(report.directivesAfter).toBe(1);
    expect(report.directivesDropped).toBeFalsy();
  });

  it("全部文件级指令形态都走同一条转挂路径（@nudo:env / @nudo:mock-module）", () => {
    for (const directive of [
      "@nudo:import { positive } from \"./shapes.nudo.js\"",
      "@nudo:env node",
      "@nudo:mock-module \"./m.js\"",
    ]) {
      const { ast, report } = stripped(
        `/// ${directive}\nimport type { Foo } from "./types.js";\nexport const x = 1;`,
      );
      expect(leadingTexts(ast.program.body[0]).join("\n")).toContain(directive);
      expect(report.directivesBefore).toBe(1);
      expect(report.directivesAfter).toBe(1);
      expect(report.directivesDropped).toBeFalsy();
    }
  });

  it("被删语句在末尾 ⇒ 指令挂到最后一个幸存节点的尾部（不丢）", () => {
    const { ast, report } = stripped(
      `export function inc(x) { return x + 1; }\n` +
        `/// @nudo:import { positive } from "./shapes.nudo.js"\n` +
        `import type { Foo } from "./types.js";`,
    );
    const b = ast.program.body;
    expect(b).toHaveLength(1);
    const rec = b[0] as unknown as { trailingComments?: { value?: string }[] };
    expect((rec.trailingComments ?? []).map((c) => c.value ?? "").join("\n")).toContain(
      "@nudo:import",
    );
    expect(report.directivesAfter).toBe(report.directivesBefore);
  });

  it("无指令的源码 ⇒ 前后条数都是 0", () => {
    const { report } = stripped(`export const x = 1;`);
    expect(report.directivesBefore).toBe(0);
    expect(report.directivesAfter).toBe(0);
    expect(report.directivesDropped).toBeFalsy();
  });
});
});
