/**
 * BUG-267 回归：`exports` 模式键的 tie-break 必须按 Node `PATTERN_KEY_COMPARE`
 * ——**前缀长度平手时比整键长度**（更长者胜），且结论不得随 package.json 里的
 * 声明顺序变化。
 *
 * 改前只比前缀长度且用严格大于 ⇒ 平手保留先声明者，宿主却取更长的键
 * ⇒ 引擎解析到另一个文件（假红 / 假绿 + 自信的错值）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveNpmJsEntry } from "../evaluator/resolve-npm.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

function makePkg(exportsField: unknown, files: Record<string, string>): {
  dir: string;
  pkgDir: string;
} {
  const dir = tmpProject("nudo-267-");
  writeTmpFiles(dir, {
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      type: "module",
      exports: exportsField,
    }),
    ...Object.fromEntries(
      Object.entries(files).map(([rel, content]) => [`node_modules/pkg/${rel}`, content]),
    ),
  });
  return { dir, pkgDir: join(dir, "node_modules", "pkg") };
}

describe("BUG-267 — exports 模式键 tie-break（PATTERN_KEY_COMPARE）", () => {
  it("前缀长度平手 ⇒ 取整键更长者（与声明顺序无关）", () => {
    // 两个键的 `*` 前前缀都是 "./x/"（长度 4）；"./x/*b" 更长 ⇒ 宿主取它。
    const longFirst = makePkg(
      { "./x/*b": "./special/*.js", "./x/*": "./dist/*.js" },
      { "special/a.js": "export const v = 1;", "dist/ab.js": "export const v = 2;" },
    );
    const shortFirst = makePkg(
      { "./x/*": "./dist/*.js", "./x/*b": "./special/*.js" },
      { "special/a.js": "export const v = 1;", "dist/ab.js": "export const v = 2;" },
    );
    expect(resolveNpmJsEntry("pkg/x/ab", longFirst.dir)).toBe(
      join(longFirst.pkgDir, "special", "a.js"),
    );
    expect(resolveNpmJsEntry("pkg/x/ab", shortFirst.dir)).toBe(
      join(shortFirst.pkgDir, "special", "a.js"),
    );
  });

  it("前缀更长者胜过整键更长者（第一判据优先）", () => {
    const { dir, pkgDir } = makePkg(
      { "./x/*bcd": "./short/*.js", "./x/y/*": "./deep/*.js" },
      { "short/a.js": "export const v = 1;", "deep/abcd.js": "export const v = 2;" },
    );
    expect(resolveNpmJsEntry("pkg/x/y/abcd", dir)).toBe(join(pkgDir, "deep", "abcd.js"));
  });

  it("#imports 面同口径（同一 tie-break）", () => {
    const dir = tmpProject("nudo-267-imports-");
    writeTmpFiles(dir, {
      "package.json": JSON.stringify({
        name: "app",
        type: "module",
        imports: { "#x/*b": "./special/*.js", "#x/*": "./dist/*.js" },
      }),
      "special/a.js": "export const v = 1;",
      "dist/ab.js": "export const v = 2;",
    });
    expect(resolveNpmJsEntry("#x/ab", dir)).toBe(join(dir, "special", "a.js"));
  });
});
