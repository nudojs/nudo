/**
 * Bug 874 — node env 的**静态 `Buffer`** 面**没有 `of`** ⇒ `Buffer.of(1, 2)`
 * 必抛 TypeError ⇒ L2 门禁假红。
 *
 * 修法：静态面挂在 `Buffer` 这个 envFn 的 slots 上（packages/env/src/node.ts），
 * `of` 用 `envFnVariadic`（原生 `Buffer.of` 是**变长**的）。静态面与实例面
 * 指向**同一个** Buffer 形状（bufferBrand），不另造第二份 Buffer 形状。
 *
 * 证据口径：原生 oracle（同进程真实 Buffer.of）+ 引擎探针。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue, formatShape } from "@nudojs/core";
import type { Abs } from "@nudojs/core";
import { defineEnv } from "../node.ts";

const env = defineEnv();

function shapeOf(a: Abs | undefined, label: string): string {
  expect(a, `expected Abs at ${label}`).toBeTruthy();
  return formatShape(a!);
}

/** fn 形全局的**静态槽**面（envFn 的 `opts.slots`） */
function staticSlot(a: Abs | undefined, name: string): Abs | undefined {
  if (!a || a.shape.k !== "fn") return undefined;
  const slots = (a.shape as { slots?: Record<string, { value: Abs }> }).slots;
  return slots?.[name]?.value;
}

function check(src: string) {
  return checkSource("/t/env-bug-874.js", src, pTrue, {
    inject: { envGlobals: env.globals },
  });
}

describe("Bug 874 — Buffer 静态面补 of（不再定抛 TypeError）", () => {
  it("原生 oracle：Buffer.of 存在且返回 Buffer（长度 2）", () => {
    expect(typeof Buffer.of).toBe("function");
    const b = Buffer.of(1, 2);
    expect(Buffer.isBuffer(b)).toBe(true);
    expect(b.length).toBe(2);
  });

  it("env：Buffer 静态面带 of（变长 fn）", () => {
    const of = staticSlot(env.globals.Buffer, "of");
    expect(of, "Buffer.of 缺失").toBeTruthy();
    expect(shapeOf(of, "Buffer.of")).toContain("=>");
    // 变长：params 末位是 rest
    const params = (of!.shape as { params?: string[] }).params ?? [];
    expect(params[params.length - 1]).toMatch(/^\.\.\./);
  });

  it("引擎探针：Buffer.of(1, 2) 不再定抛 TypeError", () => {
    const r = check(`export function useBufferOf() { return Buffer.of(1, 2); }`);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toEqual([]);
    for (const s of r.signatures) {
      expect(s.throws, `${s.name} 不应有 throws 面`).toBeUndefined();
    }
    expect(r.signatures[0]?.display).toMatch(/^Buffer\b/);
  });
});
