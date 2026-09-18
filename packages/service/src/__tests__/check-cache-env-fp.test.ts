/**
 * P0.4：check 磁盘缓存指纹必须覆盖 @nudo:env / @nudo:mock-module 路径内容。
 * 只改 env 模板、入口源码不变 → checkCacheKey 必须 miss。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAllLoadSpecs, loadModuleDepsFingerprint } from "@nudojs/core";
import { checkCacheKey } from "../disk-cache.ts";
import { collectLoadDepContents } from "../dep-contents.ts";
import { defaultLoadModule } from "../load-module.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("extractAllLoadSpecs includes path-based @nudo:env / mock-module", () => {
  it("parses unquoted path env", () => {
    const src = `/// @nudo:env ./custom.env.ts\nexport function f() { return 1; }\n`;
    const specs = extractAllLoadSpecs(src);
    expect(specs).toContain("./custom.env.ts");
  });

  it("parses comma-separated env names + path", () => {
    const src = `/// @nudo:env es, ./other.env.ts\nexport function f() { return 1; }\n`;
    const specs = extractAllLoadSpecs(src);
    expect(specs).toContain("./other.env.ts");
    // named env is not a loadModule path — must not invent a fake dep file
    expect(specs).not.toContain("es");
  });

  it("parses mock-module from path", () => {
    const src = `/// @nudo:mock-module "fs" from "./mock-fs.js"\nexport function f() { return 1; }\n`;
    const specs = extractAllLoadSpecs(src);
    expect(specs).toContain("./mock-fs.js");
  });

  it("parses partial mock-module from path", () => {
    const src = `/// @nudo:mock-module "fs" { readFileSync } from "./mock-fs.js"\nexport function f() { return 1; }\n`;
    const specs = extractAllLoadSpecs(src);
    expect(specs).toContain("./mock-fs.js");
  });
});

describe("checkCacheKey misses when only @nudo:env file content changes", () => {
  it("entry source unchanged + env template rewrite flips key", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-env-fp-"));
    dirs.push(dir);
    const envPath = join(dir, "custom.env.ts");
    const mainPath = join(dir, "main.js");
    const main = `/// @nudo:env ./custom.env.ts

/**
 * @nudo:case t ()
 */
function getMagic() {
  return MAGIC;
}
`;
    writeFileSync(mainPath, main, "utf-8");
    writeFileSync(
      envPath,
      `export function defineEnv(){ return { globals: { MAGIC: 99 } }; }\n`,
    );
    const load1 = (spec: string, fromFile: string) => defaultLoadModule(spec, fromFile);
    const dep1 = collectLoadDepContents(mainPath, main, load1);
    expect(dep1.truncated).toBe(false);
    expect(
      dep1.depContents.some(
        (d) => d.path.includes("custom.env.ts") && d.content?.includes("99"),
      ),
    ).toBe(true);

    const key1 = checkCacheKey(mainPath, main, {
      autoBind: true,
      projectDir: dir,
      depContents: dep1.depContents,
    });

    // 只改 env 文件
    writeFileSync(
      envPath,
      `export function defineEnv(){ return { globals: { MAGIC: 42 } }; }\n`,
    );
    const dep2 = collectLoadDepContents(mainPath, main, load1);
    const key2 = checkCacheKey(mainPath, main, {
      autoBind: true,
      projectDir: dir,
      depContents: dep2.depContents,
    });
    expect(key1).not.toBe(key2);

    const fp1 = loadModuleDepsFingerprint(main, load1, mainPath);
    writeFileSync(
      envPath,
      `export function defineEnv(){ return { globals: { MAGIC: 7 } }; }\n`,
    );
    const fp2 = loadModuleDepsFingerprint(main, load1, mainPath);
    expect(fp1.fp).not.toBe(fp2.fp);
  });
});
