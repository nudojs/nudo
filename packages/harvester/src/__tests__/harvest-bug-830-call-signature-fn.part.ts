/**
 * Bug 830 回归（harvester 收割面）：类型字面量的**调用签名**
 * （`{ (a: number): string }`）**整条跳过** ⇒ 该值被折成**空对象** ⇒
 * 调用即 `TypeError` ⇒ **L2 假红**（`tsc --strict` exit 0 的合法代码被判
 * 「确定抛」）。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h1b/oracle/u830.ts，tsc exit=0）：
 *   `handler: { (a: number): string }` ⇒ `handler(1)` 是 **string**（完全合法）。
 *
 * 改前（tmp/probe/fix-r27/h1b/before.ts，before-h1 快照 = git HEAD）：
 *   f: {  }    k: obj      ← 零槽位的空对象 ⇒ 引擎按「不是函数」判 ⇒ 调用即 TypeError
 * 改后（tmp/probe/fix-r27/h1b/probe.ts）：
 *   f: (number) => string    k: fn
 *
 * 根因：`mapType` 的类型字面量分支先找构造签名、找不到就走
 * `absObj(mapTypeMembers(...))`；而 `mapTypeMembers` 把**调用签名成员跳过**
 * ⇒ 结果是**零槽位的空对象**。
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

describe("Bug 830 —— 调用签名投影成 fn（不再折成空对象）", () => {
  it("调用签名产出 fn 形状（不是空 obj）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const handler: { (a: number): string };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["handler"]!.shape as FnShape;
    expect(shape.k).toBe("fn");
    // 反向钉：不能是零槽位的空对象
    expect(shape.k).not.toBe("obj");
  });

  it("形参与返回面保留（形参位是 number、返回位是 string）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const handler: { (a: number): string };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["handler"]!.shape as FnShape;
    expect((shape.paramTypes ?? []).map((t) => formatShape(t as never))).toEqual(["number"]);
    expect(formatShape(shape.returnType as never)).toBe("string");
    expect(formatShape(env.globals["handler"]!)).toBe("(number) => string");
  });

  it("多形参 / 可选形参按普通签名同口径", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const handler: { (a: number, b?: string): boolean };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["handler"]!.shape as FnShape;
    expect((shape.paramTypes ?? []).map((t) => formatShape(t as never))).toEqual([
      "number",
      "string | undefined",
    ]);
    expect(formatShape(shape.returnType as never)).toBe("boolean");
  });

  it("与调用签名共存的具名成员不丢（静态槽）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const handler: { (a: number): string; version: number };
`,
    );
    const env = harvestDts([p]);
    const shape = env.globals["handler"]!.shape as FnShape;
    expect(Object.keys(shape.slots ?? {})).toEqual(["version"]);
  });

  it("无调用签名的普通字面量仍是 obj（不误投影成 fn）", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare const plain: { a: number };
`,
    );
    const env = harvestDts([p]);
    expect(env.globals["plain"]!.shape.k).toBe("obj");
  });
});
