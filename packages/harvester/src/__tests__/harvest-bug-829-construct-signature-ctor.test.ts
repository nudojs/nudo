/**
 * Bug 829 回归（harvester 收割面）：类型字面量的**构造签名**
 * （`{ new (x: number): T }`）被投影成**普通可调用 fn** ⇒ `new C(1)`
 * **假红**（may-throw）+ `C(1)` **假绿**（TS 明确 TS2348 不可调用）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u829.ts，tsc exit=0）：
 *   `new WidgetCtor(1)` 合法 ⇒ `w.v` 是 number；
 *   `WidgetCtor(1)` **不合法**（TS2348: 不带 `new` 的调用）⇒ 夹具里用
 *   `@ts-expect-error` 钉住（tsc 消费掉了它 ⇒ TS 确实报错）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 *   C: (number) => { tag: string }    ctor facet: undefined
 *   ⇒ `new C(1)` 落 core 的「fn 形 callee 可构造性未知」臂 ⇒ **记 may-throw**
 *     ⇒ L2 门禁假红。
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 *   C: (number) => { tag: string }    ctor facet: true
 *   ⇒ core 的 `fs.ctor === true` 臂 ⇒ 走声明的实例面 ⇒ **不记 may-throw**。
 *
 * 根因：`mapType` 的类型字面量分支对构造签名只产出 `absFnSig` —— 一个
 * **没有构造面**的普通可调用 fn（注释明写「是构造函数形状」，实现没给）。
 *
 * ⚠️ 剩余半边（**需要 core**）：TS 的「不可裸调用」要 core 的 fn 形状带
 * `callable: false` facet（core 目前只有 `ctor`，没有 `callable`）。
 * core 是冻结面 ⇒ 本片只落 `ctor: true` + 构造形参，剩余部分见交付报告。
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug829-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

type FnShape = {
  k: string;
  ctor?: boolean;
  paramTypes?: unknown[];
  returnType?: unknown;
  slots?: Record<string, { value: unknown }>;
};

describe("Bug 829 —— 构造签名投影成**可构造**面（ctor facet）", () => {
  it("构造签名产出 fn 形状且带 ctor: true facet", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Widget { v: number }
export declare const WidgetCtor: { new (x: number): Widget };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["WidgetCtor"]!.shape as FnShape;
    expect(shape.k).toBe("fn");
    expect(shape.ctor).toBe(true);
    // 反向钉：不能是「可构造性未知」（undefined ⇒ core 记 may-throw ⇒ 假红）
    expect(shape.ctor).not.toBeUndefined();
  });

  it("构造形参与实例面保留（new C(1) 的实例类型是声明的返回类型）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export interface Widget { v: number }
export declare const WidgetCtor: { new (x: number): Widget };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["WidgetCtor"]!.shape as FnShape;
    expect((shape.paramTypes ?? []).map((t) => formatShape(t as never))).toEqual(["number"]);
    expect(formatShape(shape.returnType as never)).toBe("Widget");
  });

  it("构造形参是可选时带上 undefined（与普通形参同口径）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const C: { new (x?: number): { tag: string } };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["C"]!.shape as FnShape;
    expect(shape.ctor).toBe(true);
    expect(formatShape((shape.paramTypes ?? [])[0] as never)).toContain("number");
  });

  it("与构造签名共存的具名成员不丢（静态槽）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const C: { new (x: number): { tag: string }; version: number };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["C"]!.shape as FnShape;
    expect(Object.keys(shape.slots ?? {})).toEqual(["version"]);
  });

  it("无构造签名的普通字面量不带 ctor facet", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const plain: { a: number };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["plain"]!.shape as FnShape;
    expect(shape.k).toBe("obj");
    expect(shape.ctor).toBeUndefined();
  });
});
