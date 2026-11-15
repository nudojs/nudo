/**
 * BUG-097 —— guard 产物**过不了 `tsc --noEmit --strict`**（TS2367）：槽名撞
 * `Object.prototype` 具名成员（`toString` / `valueOf` / `constructor` /
 * `hasOwnProperty`）时，`data.toString` 的静态类型是原型成员的类型
 * （`Record<string, any>` 的索引签名**不遮蔽**它们）⇒ 与字面量比较 ⇒
 * "types '() => string' and 'string' have no overlap"。
 *
 * 根因：`denote.ts` 的 obj 槽访问走 `safeMemberAccess`（标识符键 ⇒ **点号**）。
 * 方括号取值让索引签名生效（静态类型 `any`）⇒ 可编译。
 *
 * 本钉：这类键必须走方括号；产物真跑 `tsc --noEmit --strict` 必须通过。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { obj, strLit, numLit, bool, abs, type Abs } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const protoSlots = (): Abs =>
  obj({
    toString: { value: strLit("s") },
    valueOf: { value: numLit(1) },
    constructor: { value: strLit("c") },
    hasOwnProperty: { value: abs({ k: "prim", type: "boolean" }, { op: "lit", value: true }, undefined, "exact") },
  });

describe("BUG-097 — 原型成员同名的槽走方括号取值（产物可编译）", () => {
  it("守卫体里不出现点号访问（`data.toString`），改用 `data[\"toString\"]`", () => {
    const g = denoteGuard(protoSlots(), "data");
    expect(g).not.toContain("data.toString");
    expect(g).not.toContain("data.valueOf");
    expect(g).not.toContain("data.constructor");
    expect(g).not.toContain("data.hasOwnProperty");
    expect(g).toContain('data["toString"]');
    expect(g).toContain('data["valueOf"]');
    expect(g).toContain('data["constructor"]');
    expect(g).toContain('data["hasOwnProperty"]');
  });

  it("产物真跑 tsc --noEmit --strict（改前 TS2367 ×4）", () => {
    const body = denoteGuard(protoSlots(), "data");
    const source =
      `export function isprotoSlotsOutput(value: unknown): boolean {\n` +
      `  const data = value as Record<string, any>;\n` +
      `  return ${body};\n}\n`;
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug097-"));
    dirs.push(dir);
    const p = join(dir, "guard.nudo.guard.ts");
    writeFileSync(p, source, "utf-8");
    let failure = "";
    try {
      execFileSync(
        "pnpm",
        ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", p],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      failure = `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}`;
    }
    expect(failure).toBe("");
  });

  it("运行时语义不变：接受真实对象，拒绝缺键对象", () => {
    const check = new Function("data", `return ${denoteGuard(protoSlots(), "data")};`) as (
      d: unknown,
    ) => boolean;
    expect(check({ toString: "s", valueOf: 1, constructor: "c", hasOwnProperty: true })).toBe(true);
    expect(check({ toString: "s", valueOf: 1, constructor: "c" })).toBe(false);
    // bool() 只用于类型对齐，不参与断言
    expect(bool().shape.k).toBe("prim");
  });
});
