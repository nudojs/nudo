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

/**
 * 宿主实测的成员 `typeof`；宿主**没有**该成员所属的根全局时为 `null`。
 *
 * 宿主面随 Node 版本漂移：`Temporal` 全局是 Node 26 才进 ESM 全局面的
 * （Node 24 没有）⇒ `typeof Temporal.Instant` 在旧宿主上直接 `ReferenceError`。
 * env 的 node 面按**最新宿主**声明 ⇒ `Temporal` 是登记过的「超前声明」
 * （见 env-bug-61 的 `DECLARED_AHEAD_OF_HOST` 漂移闸）⇒ 宿主缺失按 `null` 记，
 * 不许让旧宿主把整个 oracle 炸掉。
 */
function hostMemberTypes(): Array<string | null> {
  const probes = MEMBERS.map(
    ([, e]) =>
      `(() => { const root = globalThis.${e.slice(0, e.indexOf("."))};` +
      ` return root === undefined ? null : typeof ${e}; })()`,
  );
  const out = host(`console.log(JSON.stringify([${probes.join(", ")}]));`);
  return JSON.parse(out) as Array<string | null>;
}

describe("Bug 155 — node env declares host functions as functions", () => {
  it("host oracle: every host-provided member is typeof function", () => {
    const types = hostMemberTypes();
    expect(types).toHaveLength(MEMBERS.length);
    MEMBERS.forEach(([label], i) => {
      const t = types[i]!;
      if (t === null) {
        // 宿主没有该根全局 ⇒ 成员不存在（不是「折成了 object」）⇒ 只能超前声明
        expect(label.startsWith("Temporal."), `宿主缺 ${label} 的根全局`).toBe(true);
        return;
      }
      expect(t, `${label} typeof`).toBe("function");
    });
    // 非空的成员必须是**真函数**（不是数据值）：宿主有 ⇒ typeof 就是 "function"
    const provided = types.filter((t) => t !== null);
    expect(provided.length).toBeGreaterThan(0);
    expect(provided.every((t) => t === "function")).toBe(true);
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
