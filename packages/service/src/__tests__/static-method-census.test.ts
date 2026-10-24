/**
 * Bug 856 —— **静态类方法**在函数普查里**不可见** ⇒ 两面矛盾：
 *
 * - core 的 `scan-top-functions`（`nudo check` 的签名面）**收**静态方法
 *   （其注释明写「static 与实例方法同为入口可见」）；
 * - service 的 `collectClassMethods`（`analyzer-ast.ts`）只经由 parser 的
 *   `classInstanceMethods` 收集 —— 后者**刻意跳过 static**（那是 parser 的
 *   **公开契约**，不是缺陷）⇒ `analysis.functions` 里静态方法**不存在**
 *   ⇒ `nudo test` / `nudo health` / `nudo contract` 的函数普查
 *   **看不见**静态方法 ⇒ 与 `nudo check` 不一致。
 *
 * 修法（service 侧）：复用 parser **已导出**的 `getClassMembers` /
 * `classMemberKeyName` / `methodFunctionNode` 自行收集 static
 * ⇒ **parser 导出面零新增**（parser 侧的判定钉见
 * `packages/parser/src/__tests__/parser-bug-856-static-method-census.test.ts`）。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeFile } from "../analyzer.ts";
import { tmpProject } from "./tmp-project.ts";

describe("Bug 856: static class methods are part of the function census", () => {
  function fns(src: string): string[] {
    const dir = tmpProject("nudo-static-census-");
    const file = join(dir, "m.js");
    writeFileSync(file, src);
    const r = analyzeFile(file, src);
    return r.functions.map((f) => f.name).sort();
  }

  it("a static method is collected (same census as nudo check)", () => {
    const names = fns(`
      export class Util {
        static helper(x) { return x + 1; }
        instanceMethod(y) { return y; }
      }
    `);
    expect(names).toContain("Util.helper");
    expect(names).toContain("Util.instanceMethod");
  });

  it("several static methods are all collected", () => {
    const names = fns(`
      export class Util {
        static a(x) { return x; }
        static b(x) { return x; }
      }
    `);
    expect(names).toContain("Util.a");
    expect(names).toContain("Util.b");
  });

  it("the constructor and accessors are NOT collected as entry functions", () => {
    // 构造器 / getter / setter 不是「入口可见的函数」⇒ 不进普查
    // （与 core `scan-top-functions` 的同口径）。
    const names = fns(`
      export class Util {
        constructor(x) { this.x = x; }
        get value() { return this.x; }
        set value(v) { this.x = v; }
        static helper() { return 1; }
      }
    `);
    expect(names).toContain("Util.helper");
    expect(names.filter((n) => n.includes("constructor"))).toEqual([]);
    expect(names.filter((n) => n.includes("value"))).toEqual([]);
  });
});
