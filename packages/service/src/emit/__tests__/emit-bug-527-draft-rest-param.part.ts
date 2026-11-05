/**
 * Bug 527 —— `nudo contract --draft` 对**剩余参数（rest）**函数写出**语法非法**
 * 的草稿 ⇒ 照抄进侧车后**整份侧车语法错误**，该文件**所有**契约一起失联。
 *
 * 症状（旧口径）：草稿正文出现 `export const sum = fn({ first: number(),
 * ...rest: number() }, number());` —— `{ ...rest: number() }` 既不是合法对象
 * 字面量也不是合法契约 DSL ⇒ `node --check` 直接 SyntaxError；照抄进
 * `lib.nudo.js` 后 `nudo check` 报 `nudo:interface-load`
 * （sidecar '…/lib.nudo.js' failed to load）⇒ **整个文件**的契约失联。
 *
 * 根因：草稿的形参表渲染把 rest 形参的 `...` 标记原样写进 DSL；emitter 面
 * （`--emit`）写盘前有 `roundTrips` 自检（装不上就 not-projectable 跳过），
 * drafter 面**没有**这道闸。
 *
 * 修法：drafter 补上同一道闸——rest 形参 ⇒ 整个函数 not-projectable 跳过；
 * 且任何 DSL 落盘前先经 `execNudoModule` 装一次，装不上就不写。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftInterface, sidecarDraftPath } from "../interface-draft.ts";
import { nodeCheck } from "./draft-artifact.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-527-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const REST_JS = `export function sum(first, ...rest) { return first + rest.length; }
export function greet(user) { return "hi " + user; }
sum(1, 2, 3);
`;

describe("Bug 527 —— 草稿的 rest 形参", () => {
  it("rest 函数 not-projectable 跳过（改前：写出 ...rest: number()）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, REST_JS);
    const r = await draftInterface(file);
    const sum = r.entries.find((e) => e.fn === "sum");
    expect(sum).toBeDefined();
    expect(sum!.skipped).toBe("not-projectable");
    expect(sum!.dsl).toBeUndefined();
    expect(r.draftSource).not.toContain("...rest");
    expect(r.draftSource).toContain("sum (not-projectable)");
  });

  it("草稿产物真能过 node --check（改前：SyntaxError: Unexpected token ':'）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, REST_JS);
    const r = await draftInterface(file);
    const draftPath = sidecarDraftPath(file);
    writeFileSync(draftPath, r.draftSource, "utf-8");
    const check = nodeCheck(draftPath);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("负控制：非 rest 导出照旧出绑定行（不误跳过）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, REST_JS);
    const r = await draftInterface(file);
    const greet = r.entries.find((e) => e.fn === "greet");
    expect(greet!.skipped).toBeUndefined();
    expect(r.draftSource).toContain("export const greet = fn({});");
  });
});
