/**
 * BUG-045 CLI 回归：CJS `module.exports = { … }` 形态的导出面三方言。
 *
 * 症状（修前）：同一份 `x + 1`，`module.exports = { h(x) { … } }` 的
 *   - dts   → `export declare function h(x: any): unknown;`（check 面说 `number | string`）
 *   - zod   → `hOutput = z.unknown()`（接受一切）
 *   - guard → `return true;`（校验器空操作 = 假绿）
 * 而对照写法 `module.exports.h = fn` 三方言都正常。
 *
 * 这里钉的是**产物面**（用户实际拿到的校验器），根因与求值面回归见
 * `packages/service/src/__tests__/service-bug-045-cjs-object-export-member.test.ts`。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const OBJ_LITERAL = `module.exports = {
  h(x) {
    return x + 1;
  },
};
`;

const DOT_ASSIGN = `module.exports.h = function (x) {
  return x + 1;
};
`;

function fixture(): { obj: string; dot: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b045-"));
  dirs.push(dir);
  const obj = join(dir, "obj.js");
  const dot = join(dir, "dot.js");
  writeFileSync(obj, OBJ_LITERAL, "utf-8");
  writeFileSync(dot, DOT_ASSIGN, "utf-8");
  return { obj, dot };
}

describe("BUG-045 · CJS `module.exports = { … }` 导出面与 dot 形态同口径", () => {
  it("dts 面：返回位是真类型（不是 unknown），且与 dot 形态逐字一致", () => {
    const { obj, dot } = fixture();
    const o = runCliTsx(["export", "--format", "dts", obj]);
    const d = runCliTsx(["export", "--format", "dts", dot]);
    expect(o.status).toBe(0);
    expect(o.stdout).toContain("export declare function h(x: any): number | string;");
    expect(o.stdout).not.toContain("): unknown;");
    expect(o.stdout).toBe(d.stdout);
  }, 60000);

  it("zod 面：Output 是联合（不是 `z.unknown()`），且与 dot 形态逐字一致", () => {
    const { obj, dot } = fixture();
    const o = runCliTsx(["export", "--format", "schema", obj]);
    const d = runCliTsx(["export", "--format", "schema", dot]);
    expect(o.status).toBe(0);
    expect(o.stdout).not.toContain("hOutput = z.unknown()");
    expect(o.stdout).toContain("z.union([");
    expect(o.stdout).toBe(d.stdout);
  }, 60000);

  it("guard 面：校验器真的校验（不是 `return true;`），且与 dot 形态逐字一致", () => {
    const { obj, dot } = fixture();
    const o = runCliTsx(["export", "--format", "guard", obj]);
    const d = runCliTsx(["export", "--format", "guard", dot]);
    expect(o.status).toBe(0);
    expect(o.stdout).not.toContain("return true;");
    expect(o.stdout).toContain('typeof data === "number" || typeof data === "string"');
    expect(o.stdout).toBe(d.stdout);
  }, 60000);
});
