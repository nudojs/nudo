/**
 * Bug 587 — `migrate strip` 不改写相对模块说明符 ⇒ 产物里留着 `from "./helper"`。
 *
 * 根因：strip 只做 AST 级 TS 剥除，不碰 `import.source`；ESM 规定相对说明符
 * 必须带显式扩展名 ⇒ Node 加载不了（ERR_MODULE_NOT_FOUND），而 strip / verify /
 * check 三个面都不做链接检查 ⇒ 零告警放行。
 *
 * 期望：产物里的相对说明符指向**产物的真实文件名**（按源扩展名映射）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateStrip } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("Bug 587 — migrate strip 改写相对说明符", () => {
  it("import \"./helper\" ⇒ 产物写 \"./helper.js\"", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-587-"));
    dirs.push(dir);
    writeFileSync(join(dir, "helper.ts"), `export function helper(): number { return 1; }\n`, "utf-8");
    writeFileSync(
      join(dir, "use.ts"),
      `import { helper } from "./helper";\nexport function use(): number { return helper(); }\n`,
      "utf-8",
    );

    await migrateStrip([dir], { write: true, draft: false });

    const out = readFileSync(join(dir, "use.js"), "utf-8");
    expect(out).toContain('from "./helper.js"');
    // 改前：原样保留 "./helper" ⇒ Node 加载不了
    expect(out).not.toContain('from "./helper"');
  });

  it("export … from 也被改写", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-587b-"));
    dirs.push(dir);
    writeFileSync(join(dir, "helper.ts"), `export const v = 1;\n`, "utf-8");
    writeFileSync(join(dir, "reexport.ts"), `export { v } from "./helper";\n`, "utf-8");

    await migrateStrip([dir], { write: true, draft: false });
    expect(readFileSync(join(dir, "reexport.js"), "utf-8")).toContain('"./helper.js"');
  });

  it("包说明符不动（非相对说明符不在 ESM 扩展名规则的范围内）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-587c-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "use.ts"),
      `import { x } from "@nudojs/core";\nexport const y = x;\n`,
      "utf-8",
    );
    await migrateStrip([dir], { write: true, draft: false });
    const out = readFileSync(join(dir, "use.js"), "utf-8");
    expect(out).toContain('"@nudojs/core"');
  });

  it("相对说明符指向目录 ⇒ 补成目录索引（./dir → ./dir/index.js）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-bug-587d-"));
    dirs.push(dir);
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(join(dir, "sub", "index.ts"), `export const v = 1;\n`, "utf-8");
    writeFileSync(join(dir, "use.ts"), `import { v } from "./sub";\nexport const y = v;\n`, "utf-8");
    await migrateStrip([dir], { write: true, draft: false });
    expect(readFileSync(join(dir, "use.js"), "utf-8")).toContain('"./sub/index.js"');
  });
});
