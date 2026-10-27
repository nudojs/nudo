import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { checkNode, staticSlotOf } from "./env-bug-1044-1049-helpers.ts";

/**
 * 族 15 · BUG-155 — node env 把宿主上的**函数 / 构造器**声明成 brand（数据值）：
 * - `AbortSignal.any`（静态工厂）⇒ `typeof` 折 `"object"`（宿主 `"function"`）；
 * - `WebAssembly.Module/Instance/Memory/Table/Global` 与
 *   `Temporal.Instant/PlainDate/PlainTime/PlainDateTime/ZonedDateTime`
 *   （可 `new` 的构造器）⇒ 同样折 `"object"`。
 *
 * 后果：`if (typeof X.y === "function")` 的特性探测分支被判**恒假**
 * ⇒ 用户会据此删掉真实有效的分支（自信的错字面量）。
 *
 * 反向钉：把任一声明改回 `brandOf(...)` ⇒ 对应 `typeof` 断言必挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

const MEMBERS: Array<[label: string, expr: string]> = [
  ["AbortSignal.any", "AbortSignal.any"],
  ["WebAssembly.Module", "WebAssembly.Module"],
  ["WebAssembly.Instance", "WebAssembly.Instance"],
  ["WebAssembly.Memory", "WebAssembly.Memory"],
  ["WebAssembly.Table", "WebAssembly.Table"],
  ["WebAssembly.Global", "WebAssembly.Global"],
  ["Temporal.Instant", "Temporal.Instant"],
  ["Temporal.PlainDate", "Temporal.PlainDate"],
  ["Temporal.PlainTime", "Temporal.PlainTime"],
  ["Temporal.PlainDateTime", "Temporal.PlainDateTime"],
  ["Temporal.ZonedDateTime", "Temporal.ZonedDateTime"],
];

describe("Bug 155 — node env declares host functions as functions", () => {
  it("host oracle: every one of them is typeof function", () => {
    const out = host(`console.log(JSON.stringify([${MEMBERS.map(([, e]) => `typeof ${e}`).join(", ")}]));`);
    expect(JSON.parse(out)).toEqual(MEMBERS.map(() => "function"));
  });

  it("typeof folds to \"function\" in the node env (was自信的 \"object\")", () => {
    const src = MEMBERS.map(
      ([label], i) => `export function t${i}(){ return typeof ${label}; }`,
    ).join("\n");
    const out = checkNode(src);
    MEMBERS.forEach(([label], i) => {
      const sig = out.signatures.find((s) => s.name === `t${i}`);
      expect(sig?.display, `${label} typeof`).toBe('"function"');
    });
  });

  it("AbortSignal.any stays a callable static factory returning AbortSignal", () => {
    const any = staticSlotOf("AbortSignal", "any");
    expect(any?.shape.k).toBe("fn");
    expect(
      (any!.shape as { returnType?: { shape: { k: string; name?: string } } }).returnType?.shape.name,
    ).toBe("AbortSignal");
    const out = checkNode(`export function f(){ return AbortSignal.any([]); }`);
    expect(out.throwBrands).toEqual([]);
  });
});
