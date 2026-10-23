/**
 * 族 20 · S0（串行前置重构）—— **模块契约钉**（前向锁）。
 *
 * 本片**不吸收任何 bug**（657 / 658 / 659 / 660 / 661 / 662 / 663 / 664 / 665 /
 * 667 / 944 / 1065 全部留给片 A / B / C / D）⇒ 本钉锁的是
 * **「内部模块拆分后的导出面与薄壳形态」**，不是「某个 bug 被修好了」。
 *
 * ⚠ 本文件**直接 import 三个新内部模块**（它们在 HEAD 上**不存在**）
 * ⇒ 在 HEAD（重构前）上本文件**必然失败** ⇒ 参与**反向闸（闸④）**。
 * 「重构前后行为不变」那一面在 `cli-s0-contract-thin-shell.test.ts`
 * （只经由**公共面**断言 ⇒ 在 HEAD 上原样跑通）。
 *
 * 锁住：
 * 1. 三个新模块**各自只导出一个**被搬走的函数（导出面冻结 ⇒ 后续片
 *    只能改函数内部，不许改签名、不许再加导出）。
 * 2. `contract.ts` 变成**薄壳**：不再定义那三个分支函数，只导出
 *    `registerContractCommand`。
 * 3. **零新增公开导出**：`packages/nudojs/src/index.ts` 仍然零 `export`
 *    （`nudojs` 的 `exports` 只有 `"."` ⇒ 新模块不在公开面上）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as contractModule from "../commands/contract.ts";
import * as contractDraft from "../commands/contract-draft.ts";
import * as contractEmit from "../commands/contract-emit.ts";
import * as contractFromDts from "../commands/contract-from-dts.ts";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const commandsDir = join(repoRoot, "packages/nudojs/src/commands");

describe("族 20 S0 —— 三个新内部模块的导出面（各自只导出一个被搬走的函数）", () => {
  it("contract-draft.ts 只导出 runContractDraft", () => {
    expect(Object.keys(contractDraft).sort()).toEqual(["runContractDraft"]);
    expect(typeof contractDraft.runContractDraft).toBe("function");
  });

  it("contract-emit.ts 只导出 runContractEmit", () => {
    expect(Object.keys(contractEmit).sort()).toEqual(["runContractEmit"]);
    expect(typeof contractEmit.runContractEmit).toBe("function");
  });

  it("contract-from-dts.ts 只导出 runContractFromDts", () => {
    expect(Object.keys(contractFromDts).sort()).toEqual(["runContractFromDts"]);
    expect(typeof contractFromDts.runContractFromDts).toBe("function");
  });
});

describe("族 20 S0 —— contract.ts 变薄壳", () => {
  it("contract.ts 的唯一导出仍是 registerContractCommand", () => {
    expect(Object.keys(contractModule).sort()).toEqual(["registerContractCommand"]);
    expect(typeof contractModule.registerContractCommand).toBe("function");
  });

  it("contract.ts 不再定义被搬走的三个分支函数", () => {
    const src = readFileSync(join(commandsDir, "contract.ts"), "utf-8");
    expect(src).not.toMatch(/function runContractDraft\b/);
    expect(src).not.toMatch(/function runContractEmit\b/);
    expect(src).not.toMatch(/function runContractFromDts\b/);
    // 薄壳仍**用**这三个函数（相对 import + 调用）
    expect(src).toContain('from "./contract-draft.ts"');
    expect(src).toContain('from "./contract-emit.ts"');
    expect(src).toContain('from "./contract-from-dts.ts"');
    expect(src).toMatch(/await runContractDraft\(/);
    expect(src).toMatch(/await runContractEmit\(/);
    expect(src).toMatch(/await runContractFromDts\(/);
  });

  it("runContractPrint 仍留在 contract.ts 内（未被搬走）", () => {
    const src = readFileSync(join(commandsDir, "contract.ts"), "utf-8");
    expect(src).toMatch(/async function runContractPrint\(/);
  });
});

describe("族 20 S0 —— 零新增公开导出", () => {
  it("packages/nudojs/src/index.ts 仍然零 export", () => {
    const src = readFileSync(join(repoRoot, "packages/nudojs/src/index.ts"), "utf-8");
    expect(src).not.toMatch(/^export\s/m);
  });

  it("nudojs 的 package.json exports 仍只有 \".\"（新模块不在公开面上）", () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, "packages/nudojs/package.json"), "utf-8"),
    ) as { exports: Record<string, unknown> };
    expect(Object.keys(pkg.exports)).toEqual(["."]);
  });
});
