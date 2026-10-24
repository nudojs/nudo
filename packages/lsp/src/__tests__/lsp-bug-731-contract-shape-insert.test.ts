/**
 * Bug 731 —— A6「Add 'X' to <fn> contract shape」往侧车 `fn(...)` 的**顶层**
 * 插字段 ⇒ 契约被写坏。
 *
 * 根因：`findFnContractInsertPos`（旧实现）**不解析形参表结构**，只找 `fn(`
 * 括号内**第一层**的 `{` ⇒「往某个 shape 里补字段」被执行成「往**形参表**里
 * 加一个形参」⇒ 契约多出一个不存在的形参 ⇒ 契约与源码对不上。
 *
 * 钉（插入点契约）：
 * 1. 插入点落在**目标形参对应的 `shape({ … })` 内部**（不是形参表顶层）；
 * 2. 目标形参的契约类型不是**内联** shape（共享标识符 / 标量）⇒ 不给插入点；
 * 3. 字段**已在**契约里 ⇒ 不给插入点（不写重复键）；
 * 4. LSP 面：契约已声明该字段时**不下发**「往契约 shape 补字段」的动作
 *    （落盘即写坏契约 ⇒ 多一条 `nudo:interface-param-mismatch`）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { findFnContractInsertPos } from "../sidecar-insert.ts";
import {
  applyEdits,
  codeActionParams,
  missingFieldDiag,
  mountCodeActions,
  sidecarEdits,
} from "./lsp-bug-r90a-harness.ts";
import { withTempDir } from "./helpers.ts";

const SC_NO_NAME = `import { fn, shape, number } from "@nudojs/core";

export const greet = fn({ u: shape({ id: number() }) }, string());
`;
const SC_WITH_NAME = `import { fn, shape, string } from "@nudojs/core";

export const greet = fn({ u: shape({ name: string() }) }, string());
`;
const GREET_JS = `export function greet(u) {
  return u.name + "!";
}

greet({ id: 2 });
`;

describe("Bug 731 · 侧车补字段的插入点契约", () => {
  it("插入点落进目标形参的 shape({ … }) 内部（不是形参表顶层）", () => {
    const lines = SC_NO_NAME.split("\n");
    const pos = findFnContractInsertPos(lines, "greet", { param: "u", path: ["name"] });
    expect(pos).not.toBeNull();
    const line = lines[pos!.line]!;
    // 插入点前一个字符就是 **shape 的 `{`**（形参表的 `{` 在更左边）
    expect(line[pos!.character - 1]).toBe("{");
    expect(line.slice(0, pos!.character - 1)).toContain("shape(");
    // 落盘后：字段在 shape 里，形参表仍只有一个形参 u
    const applied = applyEdits(SC_NO_NAME, [
      { range: { start: pos!, end: pos! }, newText: " name: undefined, " },
    ]);
    expect(applied).toContain("u: shape({ name: undefined,  id: number() })");
    expect(applied).not.toContain("fn({ name:");
  });

  it("字段已在契约里 ⇒ 不给插入点（不写重复键）", () => {
    expect(
      findFnContractInsertPos(SC_WITH_NAME.split("\n"), "greet", {
        param: "u",
        path: ["name"],
      }),
    ).toBeNull();
  });

  it("目标形参的契约类型不是内联 shape ⇒ 不给插入点", () => {
    const shared = `export const a = fn(sharedShape, number());\nexport const b = fn({ y: number() }, number());\n`;
    // 共享 shape 标识符
    expect(
      findFnContractInsertPos(shared.split("\n"), "a", { param: "u", path: ["name"] }),
    ).toBeNull();
    // 标量形参
    expect(
      findFnContractInsertPos(shared.split("\n"), "b", { param: "y", path: ["name"] }),
    ).toBeNull();
    // 形参不存在
    expect(
      findFnContractInsertPos(SC_NO_NAME.split("\n"), "greet", {
        param: "nope",
        path: ["name"],
      }),
    ).toBeNull();
    // 目标 fn 不存在
    expect(
      findFnContractInsertPos(SC_NO_NAME.split("\n"), "other", { param: "u", path: ["name"] }),
    ).toBeNull();
  });

  it("LSP 面：契约缺字段时，补字段动作落在 shape 内部", () => {
    withTempDir("nudo-lsp-731-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), SC_NO_NAME, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      const edits = sidecarEdits(actions, uri);
      expect(edits.length).toBe(1);
      const landed = applyEdits(SC_NO_NAME, edits);
      expect(landed).toContain("u: shape({ name: undefined,  id: number() })");
      // 形参表没被动过（不多出形参）
      expect(landed).not.toContain("fn({ name:");
    });
  });

  it("LSP 面：契约已声明该字段 ⇒ 不下发写坏契约的动作", () => {
    withTempDir("nudo-lsp-731b-", (dir) => {
      writeFileSync(join(dir, "greet.js"), GREET_JS, "utf-8");
      writeFileSync(join(dir, "greet.nudo.js"), SC_WITH_NAME, "utf-8");
      const uri = `file://${join(dir, "greet.js")}`;
      const handler = mountCodeActions(uri, GREET_JS);
      const actions = handler(codeActionParams(uri, 4, [missingFieldDiag(4)]));
      expect(sidecarEdits(actions, uri)).toHaveLength(0);
      expect(actions.map((a) => a.title)).not.toContain(
        "Add 'name' to greet contract shape",
      );
    });
  });
});
