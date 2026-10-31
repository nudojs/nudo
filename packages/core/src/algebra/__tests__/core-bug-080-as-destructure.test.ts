/**
 * Bug 080 回归（core 转译层）：`@nudo:as` 挂在**解构声明**上被**静默忽略**
 * （零诊断）⇒ 两条语法等价的声明给出相反的类型。
 *
 * 病灶：packages/core/src/algebra/exec/transpile/stmt/statement.ts 的
 * `emitVariableDeclaration` **解构分支**从头到尾不读 `asVar`——同函数取到的
 * `asVar` 只在 Identifier 分支被消费 ⇒ 解构形态的覆盖**完全失效**。
 * 指令本身**是被采集到的**（service 侧 asTargets 非空）⇒ 连「孤儿指令」
 * 诊断都不触发 ⇒ **彻底静默**（假绿）。
 *
 * 修法（解构分支消费 asVar，与 Identifier 分支同口径）：覆盖值取代 init 的
 * **值**，原 init 仍求值（副作用 + throws 域保留——@nudo:as 是**类型覆盖**
 * 不是求值替换）；随后逐项 $get / $idx 从**覆盖值**取槽 ⇒ 每个绑定各自从
 * 覆盖形状取自己的槽（`const { a, b } = expr` ⇒ a 取槽 a、b 取槽 b）。
 *
 * 覆盖断言（不改既有断言）：
 * - 覆盖生效：解构 + `@nudo:as shape({...})` ⇒ 绑定类型取自覆盖形状；
 * - 对照钉：Identifier 形态仍生效（行为不退化）；
 * - 负控制：无指令的同一源码行为不变；覆盖只作用于被标注的那条语句。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull } from "../exec/run.ts";
import { formatShape, litValue, num, objOf, str, strLit, type Abs } from "../index.ts";
import { throwsError } from "./eval-helpers.ts";
import { parseSource } from "../parse-source.ts";

/** content 实参（合法 JSON ⇒ JSON.parse 不抛 ⇒ 返回面可观测） */
const CONTENT: Abs = strLit('{"port":8080,"host":"h"}') as Abs;

/**
 * `@nudo:as` 的命中面（与 service 侧 collectEvalReplacements 同口径）：
 * 承载指令的那条**语句**（AST 节点身份 = 源文本字符区间）。
 */
function asTargets(src: string): { varName: string; stmtStart: number; stmtEnd: number }[] {
  const ast = parseSource(src);
  const out: { varName: string; stmtStart: number; stmtEnd: number }[] = [];
  let i = 0;
  const visit = (stmts: unknown[]): void => {
    for (const s of stmts as Array<Record<string, unknown>>) {
      const t = s?.type as string | undefined;
      if (t === "VariableDeclaration" || t === "ReturnStatement") {
        const comments = ((s.leadingComments as Array<{ value?: string }>) ?? [])
          .map((c) => c.value ?? "")
          .join("\n");
        if (/@nudo:as\b/.test(comments)) {
          out.push({
            varName: `__as${i++}`,
            stmtStart: s.start as number,
            stmtEnd: s.end as number,
          });
        }
      }
      if (t === "BlockStatement") visit(s.body as unknown[]);
      if (t === "ExportNamedDeclaration" && s.declaration) visit([s.declaration]);
      if (t === "FunctionDeclaration" && s.body) {
        visit((s.body as { body: unknown[] }).body);
      }
    }
  };
  visit((ast.program.body as unknown[]) ?? []);
  return out;
}

/** 断言覆盖值：`shape({ port: number(), host: string() })` 的 Abs 形态 */
const SHAPE_ABS: Abs = objOf({
  port: { value: num() },
  host: { value: str() },
});

/** 断言覆盖值：`array(number())` 的 Abs 形态（元素域 number） */
const TUPLE_ABS: Abs = { shape: { k: "arr", element: num() }, conf: "exact" };

/** 带 @nudo:as 注入表转译 + 调用导出函数（override = 断言形状） */
function callAs(
  src: string,
  override: Abs = SHAPE_ABS,
  fnName = "f",
  args: Abs[] = [CONTENT],
) {
  const targets = asTargets(src);
  const exports = runTranspiled(src, {
    mode: "analyze",
    asOverrideTargets: targets.length ? targets : undefined,
    asOverrides: targets.length
      ? Object.fromEntries(targets.map((t) => [t.varName, override]))
      : undefined,
  });
  return callTranspiledExportFull(exports, fnName, args);
}

/** 结果的 shape 字符串 */
function shapeOf(src: string, override: Abs = SHAPE_ABS): string {
  return formatShape(callAs(src, override).result);
}

describe("Bug 080: @nudo:as 挂在解构声明上生效（覆盖按绑定名投影到各绑定）", () => {
  it("解构声明 + @nudo:as：各绑定取覆盖形状的同名槽", () => {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port, host } = JSON.parse(content);
  return { port, host };
}
`;
    // 修复前：覆盖被静默忽略 ⇒ 返回面落到 unknown
    expect(shapeOf(src)).toBe("{ port: number, host: string }");
  });

  it("解构声明 + @nudo:as：数组模式按位置投影覆盖值", () => {
    const src = `export function f(content) {
  // @nudo:as array(number())
  const [first, second] = JSON.parse(content);
  return [first, second];
}
`;
    expect(shapeOf(src, TUPLE_ABS)).toBe("[number, number]");
  });

  it("解构声明 + @nudo:as：改名绑定按源键取槽（原生语义）", () => {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port: p } = JSON.parse(content);
  return p;
}
`;
    expect(shapeOf(src)).toBe("number");
  });

  it("对照钉：Identifier 形态的覆盖仍生效（行为不退化）", () => {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const config = JSON.parse(content);
  return config;
}
`;
    expect(shapeOf(src)).toBe("{ port: number, host: string }");
  });

  it("负控制：无指令的同一源码行为不变（不凭空得到覆盖类型）", () => {
    const src = `export function f(content) {
  const { port, host } = JSON.parse(content);
  return { port, host };
}
`;
    expect(shapeOf(src)).not.toBe("{ port: number, host: string }");
  });

  it("负控制：覆盖只作用于被标注的那条语句", () => {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port, host } = JSON.parse(content);
  const other = JSON.parse(content);
  return { port, host, other };
}
`;
    // other 未被标注 ⇒ 不得取覆盖形状
    expect(shapeOf(src)).not.toContain("other: number");
  });

  it("原 init 仍求值：副作用保留（@nudo:as 是类型覆盖不是求值替换）", () => {
    const src = `let counter = 0;
function bump() { counter = counter + 1; return counter; }
export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port } = bump();
  return counter;
}
`;
    const rec = callAs(src);
    expect(litValue(rec.result)).toMatchObject({ ok: true, value: 1 });
  });

  it("原 init 仍求值：throws 域保留（不被覆盖吞掉）", () => {
    const src = `export function f(content) {
  // @nudo:as shape({ port: number(), host: string() })
  const { port } = JSON.parse(content);
  return port;
}
`;
    expect(
      throwsError(callAs(src, SHAPE_ABS, "f", [strLit("not json at all") as Abs]).throws, "SyntaxError"),
    ).toBe(true);
  });
});
