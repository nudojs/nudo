/**
 * `--from-dts --write` 的**草稿落点族**不变量（族 20 · Bug 944 / 1147 的
 * 收口回归；与 `cli-bug-944-from-dts-write-path.test.ts` /
 * `nudojs-bug-1147-contract-cli-text.test.ts` 互补 —— 那两处钉的是
 * 「用例意图」，这里钉的是**规则本身**）。
 *
 * 钉：
 * ① 落点**贴着源 `.d.ts`**（`sidecarDraftPath` 口径）⇒ **不以 CWD 为基准**
 *    ⇒ CWD 里的同名草稿不会被静默覆盖；
 * ② 落点名的 basename **不含 `.d.`**（BUG-264：`tmp/bug-report/sections/
 *    BUG-264.md` + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含
 *    `.d.` ⇒ TypeScript 的 `getDeclarationFileExtension` 判它是**声明文件**
 *    ⇒ 草稿与工具建议的复制落点都过不了 `tsc --strict`（TS1254）⇒
 *    「next」提示点名的侧车路径同样不得含 `.d.`；
 * ③ 既有草稿**存在且内容不同** ⇒ **拒绝覆盖**（exit 1）+ 提示，提示**同时**
 *    给出两个放行口子（CLI 旗标 `--force` **与** 环境变量 `NUDO_DRAFT_FORCE`）
 *    并说明「人工改过的草稿永不被覆盖」；
 * ④ 放行口子是真的：**机器原稿**（内容不同）+ `--force` / `NUDO_DRAFT_FORCE=1`
 *    ⇒ 覆盖成功；**人工改过的草稿** ⇒ `--force` 也**不放行**（逐字不变）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 夹具：`types/index.d.ts`（源）+ CWD 里另一个文件的既有草稿 */
function makeFixture(dts: string = DTS): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-inv-"));
  mkdirSync(join(dir, "types"), { recursive: true });
  writeFileSync(join(dir, "types", "index.d.ts"), dts, "utf-8");
  // CWD 里**另一个文件**（index.js）的既有草稿 —— 不得被 `--from-dts` 覆盖
  writeFileSync(join(dir, "index.nudo.draft.js"), "// @nudo:draft\n// 别的文件的草稿\n", "utf-8");
  return dir;
}

/** 落点（贴着源 `.d.ts`；BUG-264：basename 不含 `.d.`） */
function draftPathOf(dir: string): string {
  return join(dir, "types", "index.nudo.draft.ts");
}

describe("nudo contract --from-dts --write · 草稿落点族不变量", () => {
  it("落点贴着源 `.d.ts`，且 basename **不含 `.d.`**（BUG-264）", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    const draft = draftPathOf(dir);
    expect(existsSync(draft)).toBe(true);
    // BUG-264：basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ 草稿过不了 tsc
    expect(basename(draft)).not.toContain(".d.");
    expect(readFileSync(draft, "utf-8")).toContain("export const mul");
    // 不以 CWD 为基准 ⇒ CWD 里**没有**同名新草稿，别的文件的草稿逐字不变
    expect(existsSync(join(dir, "index.nudo.draft.ts"))).toBe(false);
    expect(readFileSync(join(dir, "index.nudo.draft.js"), "utf-8")).toBe(
      "// @nudo:draft\n// 别的文件的草稿\n",
    );
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("「next」提示点名的侧车路径也**不含 `.d.`**（建议的复制落点必须可编译）", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("types/index.nudo.ts");
    // BUG-264：旧名 `types/index.d.nudo.ts` 过不了 `tsc --strict`（TS1254）
    expect(r.stdout).not.toContain("types/index.d.nudo.ts");
  }, 60000); // 1 个 CLI 子进程

  it("既有草稿存在且内容不同 ⇒ 拒绝覆盖（exit 1）+ 提示**同时**给出两个放行口子", () => {
    const dir = makeFixture();
    const draft = draftPathOf(dir);
    const existing = "// @nudo:draft\n// 人工留存的既有草稿（与新生成的内容不同）\n";
    writeFileSync(draft, existing, "utf-8");

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to overwrite");
    // 提示**点名**目标落点（用户知道该去哪儿看）
    expect(r.stderr).toContain("types/index.nudo.draft.ts");
    // 两个放行口子都可见（旗标 + 环境变量）
    expect(r.stderr).toContain("--force");
    expect(r.stderr).toContain("NUDO_DRAFT_FORCE");
    // 措辞要准：人工改过的草稿永不被覆盖 ⇒ 这条拒绝是预期行为
    expect(r.stderr).toContain("hand-edited");
    // 既有草稿逐字不变 + 没有谎报成功
    expect(readFileSync(draft, "utf-8")).toBe(existing);
    expect(r.stdout).not.toContain("wrote ");
  }, 60000); // 1 个 CLI 子进程

  it("内容未变 ⇒ **不**拒绝（exit 0 + 「draft unchanged」）", () => {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const written = readFileSync(draftPathOf(dir), "utf-8");

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("draft unchanged");
    expect(readFileSync(draftPathOf(dir), "utf-8")).toBe(written);
  }, 60000); // 2 个顺序 CLI 子进程

  it("机器原稿（内容不同）+ `--force` ⇒ 覆盖成功", () => {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPathOf(dir), "utf-8");
    // 源 `.d.ts` 变了 ⇒ 新草稿内容不同（但仍是机器原稿 ⇒ 可覆盖）
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("wrote ");
    const after = readFileSync(draftPathOf(dir), "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  }, 60000); // 2 个顺序 CLI 子进程

  it("机器原稿（内容不同）+ `NUDO_DRAFT_FORCE=1` ⇒ 覆盖成功（环境变量口子同样是真的）", () => {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPathOf(dir), "utf-8");
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], {
      cwd: dir,
      env: { NUDO_DRAFT_FORCE: "1" },
    });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("wrote ");
    const after = readFileSync(draftPathOf(dir), "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  }, 60000); // 2 个顺序 CLI 子进程

  it("人工改过的草稿 ⇒ `--force` **也不放行**（逐字不变 + exit 1）", () => {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const draft = draftPathOf(dir);
    const machine = readFileSync(draft, "utf-8");
    expect(machine).toContain("@nudo:draft-fingerprint");
    // 人工改过正文 ⇒ 指纹失配 ⇒ 判定为「人工改过」
    const handEdited = `${machine}\n// 人工改动\n`;
    writeFileSync(draft, handEdited, "utf-8");

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    expect(second.status).toBe(1);
    expect(second.stderr).toContain("hand-edited");
    expect(readFileSync(draft, "utf-8")).toBe(handEdited);
    expect(second.stdout).not.toContain("wrote ");
  }, 60000); // 2 个顺序 CLI 子进程
});
