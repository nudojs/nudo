/**
 * Bug 735 —— `attachCodeActions` 在**真 server 的挂载后状态**下把
 * `agentToolDeps` 提前捕获 ⇒ 闭包里的常量恒为 `undefined` ⇒
 * `agentToolDeps.getOpenText?.(…)` 在可选链生效**之前**就抛 TypeError
 * ⇒ 整个 `textDocument/codeAction` 面全瘫（0 个 action）。
 *
 * 真 server 的时序：`server.ts` 先建 `agentToolDepsRef`（`current` 还是
 * `undefined`）→ 调 `attachCodeActions({ …, get agentToolDeps() { … } })`
 * → **之后**才回填 ref ⇒ 挂载这一刻读到的就是 `undefined`。
 *
 * 钉：挂载后 `agentToolDeps` 为 undefined 时，codeAction 不得抛，
 * 且必须给出可用 action。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  codeActionParams,
  missingFieldDiag,
  mountCodeActions,
} from "./lsp-bug-r90a-harness.ts";
import { withTempDir } from "./helpers.ts";

const GREET_JS = `export function greet(u) {
  return u.name + "!";
}

greet({ id: 2 });
`;
const GREET_SC = `import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, string());
`;

describe("Bug 735 · codeAction 面不得因 agentToolDeps 未回填而全瘫", () => {
  it("agentToolDeps = undefined（真 server 挂载后状态）时不抛且给出 action", () => {
    withTempDir("nudo-lsp-735-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      let actions: unknown;
      expect(() => {
        actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      }).not.toThrow();
      expect(Array.isArray(actions)).toBe(true);
      expect((actions as unknown[]).length).toBeGreaterThan(0);
    });
  });

  it("agentToolDeps = undefined 时侧车仍从磁盘读到（契约面可见）", () => {
    withTempDir("nudo-lsp-735b-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), GREET_SC, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      // 契约里 u 的 shape 已有 name ⇒ 不下发「往契约 shape 补字段」的动作
      // （补了就是重复键）；但**不得**因为 sidecar 读不到而崩。
      const titles = actions.map((a) => a.title);
      expect(titles.some((t) => t.includes("contract shape"))).toBe(false);
    });
  });

  it("agentToolDeps 有 getOpenText 时读**编辑器打开缓冲**的侧车文本", () => {
    withTempDir("nudo-lsp-735c-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS, {
        agentToolDeps: "buffer",
        openSidecar: {
          // 打开缓冲里的侧车：u 的 shape **没有** name ⇒ 应当给出补字段动作
          [join(dir, "greet.nudo.js")]:
            `import { fn, shape, number } from "@nudojs/core";\n\nexport const greet = fn({ u: shape({ id: number() }) }, string());\n`,
        },
      });
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const titles = actions.map((a) => a.title);
      expect(titles.some((t) => t === "Add 'name' to greet contract shape")).toBe(true);
    });
  });
});
