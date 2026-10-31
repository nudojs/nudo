/**
 * BUG-264 —— `.d.ts` 源的侧车/草稿名含 **`.d.`** ⇒ TypeScript 的
 * `getDeclarationFileExtension` 判它是**声明文件**（ambient context）⇒
 * `export const x = <表达式>` 非法（TS1254）⇒ 侧车与「工具建议的复制落点」
 * 都过不了消费端 `tsc --strict`。
 *
 * 旧口径：`api.d.ts` 剥 `.ts` 得 `api.d`，再挂 `.nudo.ts` ⇒ `api.d.nudo.ts`。
 * 现在先剥 `.d` 段：`api.d.ts → api.nudo.ts`（草稿 `api.nudo.draft.ts`），
 * basename 不再含 `.d.`。
 */
import { describe, it, expect } from "vitest";
import { basename } from "node:path";
import { sidecarPathOf } from "../sidecar-path.ts";

/** service 侧草稿落点的派生口径（interface-draft）：`.nudo.ts` → `.nudo.draft.ts` */
function draftPathOf(file: string): string {
  return sidecarPathOf(file).replace(/\.nudo\.ts$/, ".nudo.draft.ts");
}

describe("BUG-264 — .d.ts 的侧车名不含 .d.", () => {
  it("api.d.ts ⇒ api.nudo.ts（不是 api.d.nudo.ts）", () => {
    const p = sidecarPathOf("/p/api.d.ts");
    expect(p).toBe("/p/api.nudo.ts");
    expect(basename(p)).not.toContain(".d.");
  });

  it("草稿落点同样不含 .d.（工具建议的复制目标必须可编译）", () => {
    const draft = draftPathOf("/p/api.d.ts");
    expect(draft).toBe("/p/api.nudo.draft.ts");
    expect(basename(draft)).not.toContain(".d.");
  });

  it(".d.mts 同口径；普通 .ts / .mts / .js / .mjs 与幂等性不变", () => {
    expect(sidecarPathOf("/p/api.d.mts")).toBe("/p/api.nudo.ts");
    expect(sidecarPathOf("/p/lib.ts")).toBe("/p/lib.nudo.ts");
    expect(sidecarPathOf("/p/lib.mts")).toBe("/p/lib.nudo.ts");
    expect(sidecarPathOf("/p/lib.js")).toBe("/p/lib.nudo.js");
    expect(sidecarPathOf("/p/lib.mjs")).toBe("/p/lib.nudo.js");
    // 幂等（Bug 362）：已是侧车 ⇒ 不再追加第二段
    expect(sidecarPathOf("/p/lib.nudo.ts")).toBe("/p/lib.nudo.ts");
    // 旧名（历史产物）归一到新名，升级时不会留下两套视图
    expect(sidecarPathOf("/p/api.d.nudo.ts")).toBe("/p/api.nudo.ts");
  });
});
