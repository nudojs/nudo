/**
 * Bug 48 次要期望 —— 带默认值的构造器参数属性
 * （`readonly active: boolean = true`）在 `check` 签名里显示成 `_p2`。
 *
 * 根因：`strip-types.ts` 的 `lowerConstructorParameterProperties` 只解包
 * `TSParameterProperty.parameter` 为 **Identifier** 的形态；带默认值时
 * `parameter` 是 **AssignmentPattern**（`left` = Identifier）⇒ 整条
 * TSParameterProperty 原样保留 ⇒ 名字丢失（`_p2`）、`this.active = active`
 * 也不生成。dts 产物面（service emit）已由第一波修好，本钉只钉运行时
 * 降级面。
 */
import { describe, it, expect } from "vitest";
import { parseSource, stripTypes } from "../../index.ts";

type Node = Record<string, unknown> & { type?: string };

function ctorOf(src: string, clsName: string): Node {
  const ast = parseSource(src, { keepTs: true }) as unknown as {
    program: { body: Node[] };
  };
  stripTypes(ast as never, src);
  const decl = ast.program.body
    .map((n) => (n.declaration as Node | undefined) ?? n)
    .find((n) => n.type === "ClassDeclaration" && (n.id as Node | undefined)?.name === clsName) as Node;
  const members = (decl.body as Node).body as Node[];
  const ctor = members.find((m) => m.kind === "constructor") as Node;
  if (!ctor) throw new Error(`no constructor for ${clsName}`);
  return ctor;
}

const SRC = `export class Account {
  constructor(public id: number, protected name: string, readonly active: boolean = true) {}
  getId(): number { return this.id; }
}
`;

describe("Bug 48 — 带默认值的参数属性降级保留绑定名", () => {
  it("三个参数属性全部降级为普通形参，且第三个名字是 active（不是 _p2）", () => {
    const ctor = ctorOf(SRC, "Account");
    const params = ctor.params as Node[];
    expect(params).toHaveLength(3);
    for (const p of params) expect(p.type).not.toBe("TSParameterProperty");

    const firstName = (p: Node): string => {
      if (p.type === "Identifier") return p.name as string;
      if (p.type === "AssignmentPattern") return (p.left as Node).name as string;
      return "";
    };
    expect(params.map(firstName)).toEqual(["id", "name", "active"]);
    // 默认值形态保留（`active = true`）
    expect(params[2]!.type).toBe("AssignmentPattern");
  });

  it("构造器体生成 this.active = active（不再漏掉默认值字段）", () => {
    const ctor = ctorOf(SRC, "Account");
    const stmts = (ctor.body as Node).body as Node[];
    const assigns = stmts
      .map((s) => s.expression as Node | undefined)
      .filter((e): e is Node => e?.type === "AssignmentExpression")
      .map((e) => {
        const left = e.left as Node;
        const prop = (left.property as Node | undefined)?.name;
        const right = (e.right as Node | undefined)?.name;
        return `${prop}=${right}`;
      });
    expect(assigns).toContain("id=id");
    expect(assigns).toContain("name=name");
    expect(assigns).toContain("active=active");
  });
});
