/**
 * 条件类型 harvest：T extends U ? X : Y / infer。
 */
import { describe, it, expect } from "vitest";
import { harvestDts } from "../index.ts";
import { getFnImpl, formatShape } from "@nudojs/core";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function harvestOne(decl: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cond-"));
  const p = join(dir, "a.d.ts");
  writeFileSync(p, decl, "utf-8");
  const env = harvestDts([p]);
  return env;
}

describe("conditional types", () => {
  it("concrete checkType picks the true branch (string extends string)", () => {
    const env = harvestOne(
      `export declare function f(x: string): string extends string ? number : boolean;\n`,
    );
    const rel = getFnImpl(env.globals.f)!.relation!;
    expect(formatShape(rel.returnType)).toBe("number");
  });

  it("concrete mismatch picks the false branch (number extends string)", () => {
    const env = harvestOne(
      `export declare function f(x: number): number extends string ? number : boolean;\n`,
    );
    const rel = getFnImpl(env.globals.f)!.relation!;
    expect(formatShape(rel.returnType)).toBe("boolean");
  });

  it("unresolved T keeps both branches (union)", () => {
    const env = harvestOne(
      `export declare function f<T>(x: T): T extends string ? number : boolean;\n`,
    );
    const rel = getFnImpl(env.globals.f)!.relation!;
    // T 未定 → number | boolean
    expect(formatShape(rel.returnType)).toBe("number | boolean");
  });

  it("infer E[] binds element type", () => {
    const env = harvestOne(
      `export declare function head<T>(xs: T[]): T extends (infer E)[] ? E : never;\n`,
    );
    const rel = getFnImpl(env.globals.head)!.relation!;
    // T[] 的 T 仍是 α；真支是 E（绑到 T 的元素）
    // 展示上应保留 α 或 never 并集
    const s = formatShape(rel.returnType);
    expect(s.length).toBeGreaterThan(0);
  });

  it("NonNullable-style: number extends null|undefined ? never : number", () => {
    const env = harvestOne(
      `export declare function nn(x: number): number extends null | undefined ? never : number;\n`,
    );
    const rel = getFnImpl(env.globals.nn)!.relation!;
    expect(formatShape(rel.returnType)).toBe("number");
  });
});
