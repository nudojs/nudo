/**
 * Bug 945 回归（harvester **草稿面**）：类型字面量里的**方法签名**成员被丢
 * ⇒ 契约被**悄悄放宽** ⇒ **假绿**（tsc 报 TS2345，`nudo check` 却绿）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b945.ts ⇒ TS2345）：
 *   `takeCfg({ host: "h" })` —— 缺 `port` ⇒ TS2345（红）。
 *
 * 改前（git HEAD 的草稿面）：`{ host: string; port(): number }` ⇒
 *   `shape({ host: string() })` —— `port` **整个消失** ⇒ 调用点少传一个成员
 *   也不违约 ⇒ 假绿。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 *   `fn({ c: shape({ host: string(), port: fn({}, number()) }) }, string())`
 *
 * 同族：**数字键成员**（`{ 0: string; 1: number }`）也不能被丢。
 *
 * **两个产物面同口径**：收割面把方法成员建成 `port: () => number`
 * （`({ host: string, port: () => number }) => string`），草稿面建成
 * `port: fn({}, number())` ⇒ 两侧都**要求** `port` 成员 ⇒ 同一答案。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { dtsToContractDraft } from "../dts-contract-draft.ts";
import { harvestDts } from "../harvest-dts.ts";
import {
  makeWorkDir,
  removeWorkDir,
  runNudoCheck,
  writeSidecar,
} from "./harvest-bug-h8a-helpers.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeDts(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug945-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const DTS = `export declare function takeCfg(c: { host: string; port(): number }): string;
`;

describe("Bug 945 —— 草稿面：方法签名成员**不被丢**（不悄悄放宽）", () => {
  it("方法成员进契约：`port: fn({}, number())`", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("port: fn({}, number())");
    // 改前的形态：方法成员整个消失
    expect(draft.draftSource).not.toContain("shape({ host: string() })");
  });

  it("数字键成员也不被丢", () => {
    const p = writeDts(
      "fx.d.ts",
      `export declare function takeNum(c: { 0: string; 1: number }): string;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("0: string()");
    expect(draft.draftSource).toContain("1: number()");
  });

  it("产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2345 同向）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b945");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function takeCfg(c) { return c.host; }
export function use() { return takeCfg({ host: "h" }); }
`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("port");
  });

  it("收割面同口径：方法成员在收割面也在（port: () => number）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals.takeCfg!)).toBe(
      "({ host: string, port: () => number }) => string",
    );
  });
});
