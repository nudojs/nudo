/**
 * Bug 1011 回归（harvester **草稿面**）：同文件的 `type` 别名**不解析**
 * ⇒ `string` 降成 `any()` ⇒ 契约**零义务** ⇒ **假绿**；而**收割面**给的是
 * `(string) => string`（同一个声明，两个产物面答案不同）。
 *
 * oracle（`tsc --strict`，tmp/probe/fix-r27/h8a/e2e/b1011.ts ⇒ TS2322）：
 *   `function withAlias(x: string): string { return 42; }`
 *
 * 改前（git HEAD 的草稿面）：`type Id = string;` 不在符号表里 ⇒
 *   `fn({ x: any() }, any())` ⇒ 零义务 ⇒ 绿。
 * 改后（tmp/probe/fix-r27/h8a/probe.ts）：
 *   `export const withAlias = fn({ x: string() }, string());`
 *
 * **两个产物面同答案**：收割面 `(string) => string`，草稿面
 * `fn({ x: string() }, string())` ⇒ 两侧都要求 string ⇒ 同一答案。
 *
 * 附带钉：**接口**（`interface`）也要能展开（`Partial<Local>` 之类依赖它），
 * 类型别名指向**对象**时同样展开成 shape。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, literalMeetsConstraint } from "@nudojs/core";
import { dtsToContractDraft } from "../dts-contract-draft.ts";
import { harvestDts } from "../harvest-dts.ts";
import {
  asConstraint,
  fnParam,
  loadDraftExports,
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
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1011-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const DTS = `type Id = string;
export declare function withAlias(x: Id): Id;
`;

describe("Bug 1011 —— 草稿面：同文件的 type 别名**被解析**（不再零义务）", () => {
  it("别名 `type Id = string` ⇒ string()，不是 any()", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("fn({ x: string() }, string())");
    expect(draft.draftSource).not.toContain("any()");
  });

  it("契约**真的**要求 string（域隶属判定 = 零义务已消除）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const exports = loadDraftExports(draft.draftSource);
    const param = fnParam(asConstraint(exports.withAlias), "x");
    expect(literalMeetsConstraint(42, param)).toBe(false);
    expect(literalMeetsConstraint("ok", param)).toBe(true);
  });

  it("产品面：草稿抄进侧车后 `nudo check` **红**（与 tsc 的 TS2322 同向）", () => {
    const p = writeDts("fx.d.ts", DTS);
    const draft = dtsToContractDraft([p], "fx");
    const dir = makeWorkDir("b1011");
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function withAlias(x) { return 42; }\n`,
    );
    const res = runNudoCheck(target);
    removeWorkDir(dir);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("constraint-violated");
  });

  it("收割面同答案：(string) => string", () => {
    const p = writeDts("fx.d.ts", DTS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals.withAlias!)).toBe("(string) => string");
  });

  it("类型别名指向对象时展开成 shape；interface 也展开", () => {
    const p = writeDts(
      "fx.d.ts",
      `type U = { a: number };
interface Local { b: string }
export declare function withObj(x: U): U;
export declare function withIface(x: Local): Local;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("shape({ a: number() })");
    expect(draft.draftSource).toContain("shape({ b: string() })");
  });

  it("interface 的**继承成员**也在契约里（只展开自身成员 ⇒ 悄悄放宽）", () => {
    const p = writeDts(
      "fx.d.ts",
      `interface Base { base: number }
interface Ext extends Base { extra: string }
export declare function takeExt(e: Ext): void;
`,
    );
    const draft = dtsToContractDraft([p], "fx");
    expect(draft.draftSource).toContain("base: number()");
    expect(draft.draftSource).toContain("extra: string()");
  });
});
