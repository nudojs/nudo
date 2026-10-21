/**
 * Bug 793 回归（harvester 收割面）：顶层 `declare namespace` 的**运行时成员被摊平进
 * globals** ⇒ harvester **凭空造出全局**（`bar`）⇒ 并**抑制**了对应的
 * ReferenceError 诊断（裸 `bar()` 被当成有定义）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/ns/）：
 * - `declare namespace Foo { function bar(): number }` ⇒ `Foo.bar` 合法（TS 编译通过）；
 * - 裸 `bar` **不是**全局（运行时只有 `Foo.bar`）⇒ 引用它是 ReferenceError。
 *
 * 收割侧契约：
 *   1. 命名空间的运行时成员**留在命名空间的名字空间里**（`Foo.bar`），
 *      **不摊平**进 globals ⇒ `env.globals` 里**没有** `bar`；
 *   2. `Foo` 本身是命名空间对象（成员挂在它下面）；
 *   3. 只有类型（interface / type）的命名空间**不产生**运行时对象
 *      （否则 `declare namespace _ { interface X {} }` 会凭空多出一个全局 `_`）。
 *
 * 产品面（闸②，tmp/probe/fix-r27/h5/e2e/ns/）：
 * - 改前：`callBareBar() => number`（0 issue —— 伪造全局把 ReferenceError 抹掉了）；
 * - 改后：`callBareBar() => never throws ReferenceError`（诊断恢复）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug793-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

/** obj 形状的槽位名 */
function slotNames(a: unknown): string[] {
  const shape = (a as { shape?: { k?: string; slots?: Record<string, unknown> } }).shape;
  if (shape?.k !== "obj") return [];
  return Object.keys(shape.slots ?? {});
}

describe("Bug 793 —— 顶层 declare namespace 的运行时成员不摊平进 globals", () => {
  it("命名空间成员不落进 globals（不再凭空造出全局 `bar`）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare namespace Foo {
  function bar(): number;
}
`,
    );
    const env = harvestDts([p]);
    // 反向断言：改前 `env.globals["bar"]` 存在（伪造全局）
    expect(Object.hasOwn(env.globals, "bar")).toBe(false);
    expect(env.globals["bar"]).toBeUndefined();
  });

  it("命名空间对象 `Foo` 存在，成员挂在它下面（`Foo.bar`）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare namespace Foo {
  function bar(): number;
}
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["Foo"]).toBeDefined();
    expect(slotNames(env.globals["Foo"])).toEqual(["bar"]);
    expect(formatShape(env.globals["Foo"]!)).toBe("{ bar: () => number }");
  });

  it("命名空间成员仍可调用（`Foo.bar()` 的返回类型是 number）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare namespace Foo {
  function bar(): number;
}
`,
    );
    const env = harvestDts([p]);
    const foo = env.globals["Foo"]!;
    const slots = (foo as { shape: { slots: Record<string, { value: unknown }> } }).shape.slots;
    const bar = slots["bar"]!.value as { shape: { k: string; returnType?: { shape: { type?: string } } } };
    expect(bar.shape.k).toBe("fn");
    expect(bar.shape.returnType?.shape.type).toBe("number");
  });

  it("只有类型的命名空间不产生运行时对象（不凭空多出全局 `_`）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare namespace _ {
  interface LoDashStatic { uniq(xs: number[]): number[]; }
}
`,
    );
    const env = harvestDts([p]);
    expect(Object.hasOwn(env.globals, "_")).toBe(false);
  });

  it("嵌套命名空间：成员留在最深层的命名空间里", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare namespace A {
  namespace B {
    function f(): number;
  }
}
`,
    );
    const env = harvestDts([p]);
    // `f` 不在任何一层摊平
    expect(Object.hasOwn(env.globals, "f")).toBe(false);
    expect(Object.hasOwn(env.globals, "B")).toBe(false);
    expect(env.globals["A"]).toBeDefined();
    expect(slotNames(env.globals["A"])).toEqual(["B"]);
    const b = (env.globals["A"]! as { shape: { slots: Record<string, { value: unknown }> } }).shape.slots["B"]!
      .value;
    expect(slotNames(b)).toEqual(["f"]);
  });

  it("两个命名空间的同名成员互不串（不当作 overload 合并）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `declare namespace A {
  function f(): number;
}
declare namespace B {
  function f(): string;
}
`,
    );
    const env = harvestDts([p]);
    const a = (env.globals["A"]! as { shape: { slots: Record<string, { value: unknown }> } }).shape.slots["f"]!
      .value;
    const b = (env.globals["B"]! as { shape: { slots: Record<string, { value: unknown }> } }).shape.slots["f"]!
      .value;
    expect(formatShape(a)).toBe("() => number");
    expect(formatShape(b)).toBe("() => string");
  });
});
