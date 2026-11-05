/**
 * Bug 942 —— `nudo contract --draft` 对**匿名 default 导出**写出的侧车键是
 * 合成的本地名 **`_default`**，而真正生效的键是 **`default`** ⇒ 用户照工具
 * 指引把草稿抄进 `*.nudo.js` 后，契约**完全失效**（门禁假绿）；而同一产品
 * 的 `--emit` 面却把同一个函数写成 `export { _nudo_1 as default }` ⇒ 两条
 * 路径自相矛盾。
 *
 * 根因：草稿把**分析名**洗成合法标识符当侧车键，**不查模块的导出名表**
 * ⇒ 侧车键 = 本地名（匿名 default 导出没有本地名 ⇒ 合成 `_default`）。
 *
 * 修法：草稿侧车键取**导出身份**（`exportedNameOfLocal`，与
 * `interface-emitter.ts` 的 `--emit` 面同源）；绑定名不安全时走别名形态
 * `const _nudo_N = …; export { _nudo_N as <identity> };`。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveInterface } from "@nudojs/core";
import { draftInterface, sidecarDraftPath } from "../interface-draft.ts";
import { defaultLoadModule } from "../../load-module.ts";
import { nodeCheck } from "./draft-artifact.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-942-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const DEFAULT_JS = `/**\n * @nudo:case "ok" (1, 2)\n */\nexport default (a, b) => a + b;\n`;

describe("Bug 942 —— 匿名 default 导出的侧车键", () => {
  it("侧车键 = 导出身份 default（改前：_default ⇒ 绑不上）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, DEFAULT_JS);
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "default");
    expect(entry).toBeDefined();
    expect(entry!.identity).toBe("default");
    expect(r.draftSource).toContain("export { _nudo_1 as default };");
    expect(r.draftSource).not.toContain("_default");
  });

  it("草稿产物真能过 node --check", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, DEFAULT_JS);
    const r = await draftInterface(file);
    const draftPath = sidecarDraftPath(file);
    writeFileSync(draftPath, r.draftSource, "utf-8");
    const check = nodeCheck(draftPath);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("照抄草稿进侧车 ⇒ 契约真的绑上（改前：键 _default ⇒ 绑不上 ⇒ 假绿）", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, DEFAULT_JS);
    const r = await draftInterface(file);
    // 照工具指引：把草稿原样抄成正式侧车
    writeFileSync(sidecarDraftPath(file).replace(/\.nudo\.draft\./, ".nudo."), r.draftSource, "utf-8");
    const eff = effectiveInterface(DEFAULT_JS, "default", {
      loadModule: defaultLoadModule,
      fromFile: file,
      autoBind: true,
    });
    expect(eff).toBeDefined();
    expect(eff!.params.map((p) => p.param)).toEqual(["a", "b"]);
  });
});
