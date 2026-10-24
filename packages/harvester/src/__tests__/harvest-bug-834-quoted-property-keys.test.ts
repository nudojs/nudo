/**
 * Bug 834 —— `nudo contract --from-dts` 对**带引号 / 连字符的属性键**产出
 * **语法非法**的草稿 ⇒ 按草稿指引抄进 `*.nudo.js` 后 sidecar **加载失败**
 * ⇒ `nudo check` 门禁由绿转红（exit 1）。
 *
 * 改前（真实产品面取证）：
 * ```
 * export const withHeaders = fn({ x: shape({ content-type: string(), … }) }, any());
 * ```
 * ⇒ `node --check` SyntaxError；抄进侧车 ⇒ `nudo:interface-load` ⇒ exit 1。
 *
 * 修法（草稿面）：属性键走**合法转义**（`formatObjectKey`：JS 标识符 /
 * 字符串字面量两种合法形态）；`__proto__` 走**计算属性名**（对象字面量里的
 * `__proto__: v` 即便带引号也会触发 `[[SetPrototypeOf]]` ⇒ 成员消失）。
 *
 * 回归钉**真把草稿抄进侧车再跑 `nudo check`**（语法非法 ⇒ 加载失败）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { dtsToContractDraft, formatDtsContractDraft } from "../dts-contract-draft.ts";
import { makeWorkDir, removeWorkDir, runNudoCheck, writeSidecar } from "./harvest-bug-h8b-helpers.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const KEYS_DTS = `export declare function withHeaders(x: { "content-type": string; "x-foo": number; plain: boolean }): void;
export declare function plainFn(a: number, b: string): boolean;
`;

function writeDts(name: string, src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug834-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, src, "utf-8");
  return file;
}

/** `node --check`：草稿必须是**合法 JavaScript** */
function nodeCheck(file: string): { ok: boolean; stderr: string } {
  try {
    execFileSync(process.execPath, ["--check", file], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

describe("Bug 834 —— --from-dts 的属性键转义", () => {
  it("带引号 / 连字符的键产出**合法**的 DSL（引号串形态）", () => {
    const file = writeDts("keys.d.ts", KEYS_DTS);
    const draft = dtsToContractDraft([file], "keys");
    expect(draft.draftSource).toContain('"content-type": string()');
    expect(draft.draftSource).toContain('"x-foo": number()');
    // 改前：裸键（`content-type: string()` ⇒ `content - type` 被解析成减法）
    expect(draft.draftSource).not.toContain("content-type: string()");
    expect(draft.draftSource).not.toContain("x-foo: number()");
    // 标识符键仍是裸写（合法形态）
    expect(draft.draftSource).toContain("plain: boolean()");
  });

  it("草稿产物真能过 `node --check`（改前：Unexpected token）", () => {
    const file = writeDts("keys.d.ts", KEYS_DTS);
    const draft = dtsToContractDraft([file], "keys");
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug834-check-"));
    dirs.push(dir);
    const out = join(dir, "keys.nudo.draft.js");
    writeFileSync(out, draft.draftSource, "utf-8");
    const check = nodeCheck(out);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("`__proto__` 键走计算属性名（对象字面量的 __proto__ 会改原型）", () => {
    const file = writeDts(
      "proto.d.ts",
      `export declare function withProto(x: { "__proto__": string; ok: number }): void;
`,
    );
    const draft = dtsToContractDraft([file], "proto");
    expect(draft.draftSource).toContain('["__proto__"]: string()');
    // 裸 `__proto__:` 会触发 [[SetPrototypeOf]] ⇒ 成员从字面量里消失
    expect(draft.draftSource).not.toContain('"__proto__": string()');
  });

  it("**抄进侧车后 `nudo check` 仍然绿**（改前：sidecar 加载失败 ⇒ exit 1）", () => {
    const file = writeDts("keys.d.ts", KEYS_DTS);
    const draft = dtsToContractDraft([file], "keys");
    const dir = makeWorkDir("834");
    dirs.push(dir);
    const { target } = writeSidecar(
      dir,
      draft.draftSource,
      `export function withHeaders(x) {\n  return x;\n}\n`,
    );
    const res = runNudoCheck(target);
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
    expect(res.stdout).not.toContain("nudo:interface-load");
    // 契约真的落到侧车上了（签名里带引号的键）
    expect(res.stdout).toContain('"content-type"');
  }, 120_000);

  it("反向闸：语法非法的侧车**必定**加载失败（证明上一条不是永真断言）", () => {
    const dir = makeWorkDir("834-broken");
    dirs.push(dir);
    const { target } = writeSidecar(
      dir,
      `import { fn, number, string, shape } from "@nudojs/core";\n\nexport const withHeaders = fn({ x: shape({ content-type: string() }) }, number());\n`,
      `export function withHeaders(x) {\n  return x;\n}\n`,
    );
    const res = runNudoCheck(target);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toContain("nudo:interface-load");
  }, 120_000);

  it("导出名撞 builder import ⇒ 走别名形态（草稿仍是合法 JS）", () => {
    // 与 Bug 545 同一族（草稿的 import ↔ export 撞名 ⇒ SyntaxError）：
    // 这里用**当前**的 builder（`number`）钉住「撞名走别名」这条不变量。
    const src = formatDtsContractDraft("types", ["types.d.ts"], [
      { name: "number", dsl: "number()", kind: "value" },
    ]);
    expect(src).not.toMatch(/^export const number = /m);
    expect(src).toContain("export { _nudo_1 as number };");
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug834-clash-"));
    dirs.push(dir);
    const out = join(dir, "types.nudo.draft.js");
    writeFileSync(out, src, "utf-8");
    const check = nodeCheck(out);
    expect(check.ok, check.stderr).toBe(true);
  });
});
