/**
 * Bug 506 —— dts 生成器对**剩余参数（rest parameter）**函数产出**非法
 * TypeScript**（tsc 报 TS2370 / TS1014）。
 *
 * 症状（旧口径）：
 * - `export declare function sum(...xs: number): number;` ⇒ TS2370
 *   （剩余参数必须是数组类型）；
 * - `export declare function sum3(...xs: number, arg1: number, arg2: number)`
 *   ⇒ TS1014（剩余参数必须最后）+ TS2370。
 *
 * 根因（两处叠加）：
 * - 参数表长度取自**观测到的 case 实参个数**（rest 天然吞掉 N 个实参 ⇒
 *   元数 N > 声明形参数 1 ⇒ 多余槽位被当成普通形参追加在 rest 之后）；
 * - case-widen 路径（paramTypeFromAbs）**漏了**契约路径才有的
 *   `isRest → T[]` 提升 ⇒ rest 槽类型是单个实参类型而非数组类型。
 *
 * 修法：参数表长度取**声明形参表**（rest 吞掉全部尾部实参 ⇒ 长度 = 声明
 * 长度，rest 必居末位）；case-widen 路径复用 rest → T[] 提升。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeFile } from "@nudojs/service";
import { generateDts } from "../dts-generator.ts";
import { tmpProject } from "../../__tests__/tmp-project.ts";

/** tsc --noEmit --strict 实测（.d.ts 必须真能编译） */
function tscNoEmit(files: Record<string, string>): { ok: boolean; stderr: string } {
  const dir = tmpProject("nudo-dts-rest-");
  const paths: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    writeFileSync(p, content.endsWith("\n") ? content : content + "\n", "utf-8");
    paths.push(p);
  }
  try {
    execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--strict", "--ignoreConfig", ...paths],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

/** rest 形参提升为数组（元素类型词随类型渲染面口径变化） */
const REST_ARRAY_RE = (name: string) =>
  new RegExp(`export declare function ${name}\\(\\.\\.\\.xs: \\w+\\[\\]\\): \\w+;`);
/** 非 rest 形参仍是普通参数 + 尾部可选（类型词随类型渲染面口径变化） */
const NONREST_OPTIONAL_RE =
  /export declare function add\(a: \w+( \| \w+)?, b\?: (unknown|any)\): \w+( \| \w+)?;/;

describe("Bug 506 —— dts 剩余参数", () => {
  it("rest 形参类型提升为数组（TS2370）", () => {
    const source = `
/**
 * @nudo:case "c" (1)
 */
export function sum(...xs) { return xs.length; }
`;
    const dts = generateDts(analyzeFile("/test/s2-rest.js", source));
    // rest 形参提升为**数组**（TS2370 的修法）。元素类型词（number / any）是
    // 类型渲染面的口径：无断言的 case 指令只是见证、不是域声明 ⇒ 产物面取
    // 推断域（Bug 511）⇒ 元素落到 any。
    expect(dts).toMatch(REST_ARRAY_RE("sum"));
    expect(dts).not.toContain("...xs: number;");
  });

  it("rest 吞掉全部尾部实参：参数表不再追加 argN（TS1014）", () => {
    const source = `
/**
 * @nudo:case "c" (1, 2, 3)
 */
export function sum3(...xs) { return xs.length; }
`;
    const dts = generateDts(analyzeFile("/test/s2-rest3.js", source));
    // 同上（元素类型词见上）
    expect(dts).toMatch(REST_ARRAY_RE("sum3"));
    expect(dts).not.toContain("arg1");
    expect(dts).not.toContain("arg2");
  });

  it("产物真能过 tsc --noEmit --strict（改前：TS2370 / TS1014）", () => {
    const source = `
/**
 * @nudo:case "c" (1, 2, 3)
 */
export function sum3(...xs) { return xs.length; }
`;
    const dts = generateDts(analyzeFile("/test/s2-rest-tsc.js", source));
    const check = tscNoEmit({ "mod.d.ts": dts });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("负控制：非 rest 形参仍是普通参数（不误提升为数组）", () => {
    const source = `
/**
 * @nudo:case "c" (1)
 */
export function add(a, b) { return a + b; }
`;
    const dts = generateDts(analyzeFile("/test/s2-nonrest.js", source));
    // 类型词（unknown / any / number）是类型渲染面的口径（不在本分片职责内）——
    // 本钉只关心**可选性**标记与「没被误提升成数组」。
    expect(dts).toMatch(NONREST_OPTIONAL_RE);
    expect(dts).not.toContain("number[]");
  });
});
