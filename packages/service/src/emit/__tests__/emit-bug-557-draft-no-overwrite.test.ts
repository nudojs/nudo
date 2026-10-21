/**
 * Bug 557 —— `nudo contract --draft --write` **静默覆盖**已手改的
 * `*.nudo.draft.js` ⇒ 用户评审成果**无声丢失**（而生成文件自己的头写着
 * 「Handwritten contracts are never overwritten.」）。
 *
 * 症状（旧口径）：落盘判定只比较「磁盘内容 vs 本次生成的文本」是否**逐字
 * 不同**（`prev !== draftSource`），**没有任何「这份草稿是否已被人工改过」的
 * 判定** ⇒ 只要用户改过草稿，重跑 `--draft --write` 就无条件覆盖，exit 0，
 * 零告警。
 *
 * 修法：草稿正文带**内容指纹**（生成时的正文 hash，写进文件头）。落盘前
 * 核对既有文件的指纹与它自己的正文：一致 ⇒ 仍是机器原稿，可覆盖；不一致
 * （或根本没有指纹 ⇒ 来源不明）⇒ **拒绝覆盖**并回报「已存在且被手改，
 * 未覆盖」。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  draftInterface,
  formatDraftSummary,
  sidecarDraftPath,
  writeInterfaceDraft,
} from "../interface-draft.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-557-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const LIB_JS = `export function add(a, b) {\n  return a + b;\n}\n`;

describe("Bug 557 —— 草稿落盘不覆盖人工改过的文件", () => {
  it("既有草稿被手改过 ⇒ 拒绝覆盖且原样保留（改前：静默覆盖）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, LIB_JS);
    const r = await draftInterface(file);
    const draftPath = sidecarDraftPath(file);
    const handEdited = `// HAND EDITED BY USER\n${r.draftSource}`;
    writeFileSync(draftPath, handEdited, "utf-8");

    const w = writeInterfaceDraft(file, r.draftSource, { entries: r.entries });
    expect(w.written).toBe(false);
    expect(w.skipped).toBe("hand-edited");
    expect(readFileSync(draftPath, "utf-8")).toBe(handEdited);

    const text = formatDraftSummary("lib.js", draftPath, r, w).join("\n");
    expect(text).toContain("hand-edited");
    expect(text).toContain("not overwritten");
  });

  it("负控制：机器原稿（指纹一致）仍可被覆盖（源变化后重生成）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, LIB_JS);
    const r1 = await draftInterface(file);
    const draftPath = sidecarDraftPath(file);
    const w1 = writeInterfaceDraft(file, r1.draftSource, { entries: r1.entries });
    expect(w1.written).toBe(true);

    // 源变了 ⇒ 新草稿文本不同 ⇒ 机器原稿（指纹自洽）应被覆盖
    writeFileSync(file, `${LIB_JS}export function sub(a, b) {\n  return a - b;\n}\n`);
    const r2 = await draftInterface(file);
    const w2 = writeInterfaceDraft(file, r2.draftSource, { entries: r2.entries });
    expect(w2.written).toBe(true);
    expect(readFileSync(draftPath, "utf-8")).toBe(r2.draftSource);
  });

  it("负控制：同内容重跑 ⇒ 幂等（unchanged，不写盘）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, LIB_JS);
    const r = await draftInterface(file);
    const draftPath = sidecarDraftPath(file);
    writeInterfaceDraft(file, r.draftSource, { entries: r.entries });
    const w2 = writeInterfaceDraft(file, r.draftSource, { entries: r.entries });
    expect(w2.changed).toBe(false);
    expect(w2.written).toBe(false);
    expect(w2.skipped).toBeUndefined();
  });
});
