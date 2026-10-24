/**
 * Bug 362 回归：`sidecarPathOf` 对**已经是侧车**的输入不幂等 ⇒
 * `lib.nudo.js` → `lib.nudo.nudo.js`（该路径不是任何源码的侧车 ⇒ 契约永久
 * 静默失效；草稿面还会落到 `lib.nudo.nudo.draft.js` 并指示用户拷进一个
 * 不存在的侧车名）。
 *
 * 修法：`sidecarPathOf` 先剥掉已有的 `.nudo` 段再挂目标扩展名 ⇒ 幂等。
 * （service 的 `sidecarDraftPath` 与 lsp 的草稿路径都基于它 ⇒ 自动受益，
 *  无需改动那两个包。）
 */
import { describe, it, expect } from "vitest";
import { sidecarPathOf } from "../sidecar-path.ts";

describe("Bug 362: 侧车路径幂等", () => {
  it("普通源码路径不变", () => {
    expect(sidecarPathOf("/a/lib.js")).toBe("/a/lib.nudo.js");
    expect(sidecarPathOf("/a/lib.mjs")).toBe("/a/lib.nudo.js");
    expect(sidecarPathOf("/a/lib.ts")).toBe("/a/lib.nudo.ts");
    expect(sidecarPathOf("/a/lib.mts")).toBe("/a/lib.nudo.ts");
  });

  it("已是侧车时幂等（不再追加第二段 .nudo）", () => {
    expect(sidecarPathOf("/a/lib.nudo.js")).toBe("/a/lib.nudo.js");
    expect(sidecarPathOf("/a/lib.nudo.ts")).toBe("/a/lib.nudo.ts");
    expect(sidecarPathOf("/a/lib.nudo.mjs")).toBe("/a/lib.nudo.js");
    expect(sidecarPathOf("/a/lib.nudo.mts")).toBe("/a/lib.nudo.ts");
  });

  it("其它扩展名仍按旧口径追加 .nudo.js", () => {
    expect(sidecarPathOf("/a/lib.cjs")).toBe("/a/lib.cjs.nudo.js");
    expect(sidecarPathOf("/a/lib")).toBe("/a/lib.nudo.js");
  });

  it("幂等：连续两次调用结果相同", () => {
    const once = sidecarPathOf("/a/lib.nudo.js");
    expect(sidecarPathOf(once)).toBe(once);
  });
});
