/**
 * CLI 冒烟：`nudo contract --draft` 输出内联「可直接 uncomment 的建议行」
 * （service/emit/contract-draft.ts 的 formatDraftModule 变更在 CLI 面可见）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx, writeSrcTsconfig } from "./helpers/run-cli.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-cli-draft-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("nudo contract --draft inline suggestion", () => {
  it("prints an uncommentable suggestion line above the empty binding", () => {
    const file = join(dir, "getName.js");
    writeFileSync(file, `export function getName(user) { return user.name; }\n`);
    const r = runCliTsx(["contract", "--draft", file]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain(
      "// suggested (uncomment to accept — body-read, not a contract):",
    );
    // 去 `// ` 即合法侧车绑定语句；绑定名与 export 行一致
    expect(r.stdout).toContain(
      "// export const getName = fn({ user: shape({ name: any() }) });",
    );
    expect(r.stdout).toContain("export const getName = fn({});");
  });

  it("no suggestion lines for bindings without body-read evidence", () => {
    const file = join(dir, "double.js");
    writeFileSync(file, `export function double(x) {\n  return x * 2;\n}\ndouble(21);\n`);
    const r = runCliTsx(["contract", "--draft", file]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("export const double = fn({ x: number() }, number());");
    expect(r.stdout).not.toContain("// export const double = ");
    expect(r.stdout).not.toContain("uncomment to accept");
  });

  // BUG-250 / BUG-268：草稿建议不得把强制转换 / 数值字面量一侧的 `+` /
  // 关系运算符 / lastIndexOf / valueOf 当成类型证据（夹具钉 src tsconfig，
  // 否则子进程按 dist 解析 @nudojs/*，测到旧实现）。
  it("coercion/operator reads stay any() in CLI draft output (BUG-250/268)", () => {
    writeSrcTsconfig(dir);
    writeFileSync(
      join(dir, "evidence.ts"),
      `export function viaString(o: { retries: number }): string { return String(o.retries); }
export function label(o: { prefix: string }): string { return o.prefix + 1; }
export function relRule(o: { a: string; b: string }): boolean { return o.a < o.b; }
export function lastIdx(o: { xs: number[] }): number { return o.xs.lastIndexOf(1); }
export function valueOfRule(o: { s: string }): string { return o.s.valueOf(); }
export function viaToUpper(o: { s: string }): string { return o.s.toUpperCase(); }
`,
    );
    const r = runCliTsx(["contract", "--draft", "evidence.ts"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("// export const viaString = fn({ o: shape({ retries: any() }) });");
    expect(r.stdout).toContain("// export const label = fn({ o: shape({ prefix: any() }) });");
    expect(r.stdout).toContain(
      "// export const relRule = fn({ o: shape({ a: any(), b: any() }) }",
    );
    expect(r.stdout).toContain("// export const lastIdx = fn({ o: shape({ xs: any() }) });");
    expect(r.stdout).toContain("// export const valueOfRule = fn({ o: shape({ s: any() }) });");
    // 真接收者方法证据不变
    expect(r.stdout).toContain("// export const viaToUpper = fn({ o: shape({ s: string() }) });");
    expect(r.stdout).not.toContain("retries: string()");
    expect(r.stdout).not.toContain("prefix: number()");
    expect(r.stdout).not.toContain("xs: string()");
    expect(r.stdout).not.toContain("s: number()");
  });

  // BUG-266 / BUG-267 / BUG-269：throws 槽的符号绑定、单行 JSDoc 载荷、
  // 建议行的 throws 槽必须三处一致。
  it("single-line JSDoc throws: litC alias, no '*/', suggestion keeps throws (BUG-266/267/269)", () => {
    writeSrcTsconfig(dir);
    writeFileSync(
      join(dir, "throws.ts"),
      `/** @nudo:throws TypeError, RangeError */
export function parse(o: { name: string }): string { return o.name; }
`,
    );
    const r = runCliTsx(["contract", "--draft", "throws.ts"], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('import { fn, any, shape, litC as lit, union } from "@nudojs/core";');
    expect(r.stdout).not.toContain('"*/"');
    expect(r.stdout).toContain(
      "// export const parse = fn({ o: shape({ name: any() }) }, any(), { throws: union(lit(\"TypeError\"), lit(\"RangeError\")) });",
    );
    expect(r.stdout).toContain(
      'export const parse = fn({}, any(), { throws: union(lit("TypeError"), lit("RangeError")) });',
    );
  });

  // BUG-361：泛化返回兜底（widened/partial）不得被严格置信闸门挡住。
  it("widened/partial generalized returns project number() (BUG-361)", () => {
    writeSrcTsconfig(dir);
    writeFileSync(
      join(dir, "unionparam.ts"),
      `export function a(x: number) { return x + 1; }
export function b(x: number | null) { return x + 1; }
export function c(x: number | null) { return (x ?? 0) + 1; }
export function d(x: number | undefined) { return x + 1; }
export function g(x: number | string) { return x; }
`,
    );
    const r = runCliTsx(["contract", "--draft", "unionparam.ts"], { cwd: dir });
    expect(r.status).toBe(0);
    for (const fn of ["a", "b", "c", "d"]) {
      expect(r.stdout).toContain(`export const ${fn} = fn({}, number());`);
    }
    expect(r.stdout).not.toContain("not projectable: number */");
    // 真不可表达的联合仍诚实标注
    expect(r.stdout).toContain("not projectable: number | string");
  });
});
