/**
 * BUG-233 —— `nudo export` 静默吞掉自己已收集的 `nudo:interface-conflict`。
 *
 * `collectExportDiagnostics` 的阻断判据只看 `severity === "error"`，而
 * `nudo:interface-conflict` 是 **warning** 级；`export.ts` 又只在 `blocking`
 * 时才上屏 ⇒ 已收集的诊断既不打印也不阻断 ⇒ 出货「只编码了一半契约」的产物、
 * stderr 空、exit 0，与同文件 `nudo check` 的结论相反。
 *
 * 钉：阻断判据与 `EXPORT_BLOCKING_CODES` **按码**对齐 ⇒ 该族任一成员都阻断
 * （诊断上屏 + exit 1）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli } from "./helpers/run-cli.ts";

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-233-"));
  writeFileSync(join(dir, "package.json"), `{"name":"fixture","type":"module"}\n`, "utf-8");
  writeFileSync(
    join(dir, "lib.js"),
    `/// @nudo:import { big } from "./lib.nudo.js"\n/**\n * @nudo:contract n big\n */\nexport function undec(n) {\n  return n;\n}\nundec({ a: 1 });\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, "lib.nudo.js"),
    `import { fn, number, shape } from "@nudojs/core";\nexport const big = number().ge(5);\nexport const undec = fn({ n: shape({ a: number() }) });\n`,
    "utf-8",
  );
  return dir;
}

describe("BUG-233 —— export 不得静默吞掉接口冲突诊断", () => {
  it("warning 级 nudo:interface-conflict ⇒ 阻断（诊断上屏 + exit 1）", () => {
    const dir = makeFixture();
    const r = runCli(["export", "lib.js", "--format", "all"], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("interface-conflict");
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）
});
