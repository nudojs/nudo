/**
 * BUG-116 —— `nudo migrate strip` 对**确实存在**的相对说明符报
 * 「could not be resolved」⇒ 输出与事实相反。
 *
 * 根因：`resolveProductSpecifier` 的候选表**从不包含「说明符原样」**——
 * `./foo.js`（`foo.js` 存在）只会试 `foo.js.ts` / `foo.js.js` / `index.*`
 * （以及 `.js→.ts` 映射），全部不命中 ⇒ 落到 note 分支。
 *
 * 修复：候选表第一项 = 说明符原样（已带显式扩展名且命中 ⇒ 什么都不用改）。
 *
 * 反向闸：`./foo`（只有 `foo.ts`）仍要补成 `./foo.js`（ESM 必须显式扩展名）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripTsToJs } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function dirWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mig-116-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  for (const name of files) {
    writeFileSync(join(dir, "src", name), "export const v = 1;\n", "utf-8");
  }
  return dir;
}

const MAIN = (spec: string) =>
  `import { v } from "${spec}";\nexport const main = () => v;\n`;

describe("Bug 116: 已存在的说明符不得报 could-not-be-resolved", () => {
  it("`./foo.js`（foo.js 存在）⇒ 无 note，说明符保持原样", () => {
    const dir = dirWith(["foo.js"]);
    const { code, notes } = stripTsToJs(MAIN("./foo.js"), {
      filePath: join(dir, "src", "main.ts"),
    });
    expect(notes.join("\n")).not.toContain("could not be resolved");
    expect(code).toContain('from "./foo.js"');
  });

  it("`./foo.js` 但只有 `foo.ts` ⇒ 走 .js→.ts 映射（无 note）", () => {
    const dir = dirWith(["foo.ts"]);
    const { notes } = stripTsToJs(MAIN("./foo.js"), {
      filePath: join(dir, "src", "main.ts"),
    });
    expect(notes.join("\n")).not.toContain("could not be resolved");
  });

  it("反向闸：`./foo`（只有 foo.ts）⇒ 补成 `./foo.js`", () => {
    const dir = dirWith(["foo.ts"]);
    const { code } = stripTsToJs(MAIN("./foo"), { filePath: join(dir, "src", "main.ts") });
    expect(code).toContain('from "./foo.js"');
  });

  it("反向闸：说明符**真的**不存在 ⇒ 仍要报 could-not-be-resolved", () => {
    const dir = dirWith([]);
    const { notes } = stripTsToJs(MAIN("./nope"), { filePath: join(dir, "src", "main.ts") });
    expect(notes.join("\n")).toContain("could not be resolved");
  });
});
