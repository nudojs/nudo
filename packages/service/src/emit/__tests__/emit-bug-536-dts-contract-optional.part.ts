/**
 * Bug 536 —— 契约的**顶层形参「可选性」**在 dts / zod 面全丢 ⇒ 生成的
 * `.d.ts` **拒绝契约允许的调用**（实测 TS2345）；契约面（权威）却显示
 * `x: number().optional()`。
 *
 * 根因（dts 那半）：顶层形参的「可选」只有**声明级**（带默认值）一个来源，
 * **契约级**（侧车 `fn({ x: number().optional() }, …)`）完全不被读。
 * 契约约束的 `isOptional` 在 `constraintToEntryAbs` 里对标量契约**丢失**
 * （entry Abs 无该信息）⇒ 可选性必须由契约面**显式带过来**。
 *
 * 修法：`DtsContractFace.params[].optional` 新增可选标记（契约面直传
 * `constraint.isOptional`），dts 侧读它渲染 `x?: T`。
 *
 * ⚠️ 越界（不在本分片文件清单内）：CLI 侧
 * `packages/nudojs/src/commands/export.ts` 的 `contractParamsOf` 需补
 * `optional: p.constraint.isOptional === true`；zod 那半
 * （`inputSlots` 装配）归 S6。
 */
import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { num, str, type Abs } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";
import { projectFunctionDts } from "../dts-generator.ts";
import { tmpProject } from "../../__tests__/tmp-project.ts";

const neverAbs = (): Abs =>
  ({ shape: { k: "never" }, conf: "exact" }) as unknown as Abs;

/** tsc --noEmit --strict 实测 */
function tscNoEmit(files: Record<string, string>): { ok: boolean; stderr: string } {
  const dir = tmpProject("nudo-dts-copt-");
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

describe("Bug 536 —— dts 顶层形参吃契约级可选性", () => {
  it("契约声明 optional 的**尾部**形参渲染成 `x?: T`", () => {
    const source = `export function act(x, s) { return s; }\n`;
    const result = analyzeFile("/test/s2-copt.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "x", abs: num() },
        { name: "s", abs: str(), optional: true },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act(x: number, s?: string)",
    );
  });

  it("契约声明 optional 的**中间**形参渲染成 `T | undefined`（TS1016：`?` 不能跟在必填位后）", () => {
    const source = `export function act(x, s) { return s; }\n`;
    const result = analyzeFile("/test/s2-copt-mid.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "x", abs: num(), optional: true },
        { name: "s", abs: str() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act(x: number | undefined, s: string)",
    );
    expect(p.lines.join("\n")).not.toContain("x?: number, s: string");
  });

  it("消费方按契约允许的调用（传 undefined / 省略）不再吃 TS2345", () => {
    const source = `export function act(x, s) { return s; }\n`;
    const result = analyzeFile("/test/s2-copt2.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "x", abs: num(), optional: true },
        { name: "s", abs: str() },
      ],
    });
    const check = tscNoEmit({
      "mod.d.ts": p.lines.join("\n") + "\n",
      "use.ts":
        'import { act } from "./mod.js";\nexport const r1 = act(undefined, "hello");\n',
    });
    expect(check.ok, check.stderr).toBe(true);
  });

  it("负控制：契约未申报可选的形参仍是必填", () => {
    const source = `export function act(x, s) { return s; }\n`;
    const result = analyzeFile("/test/s2-copt3.js", source);
    const fn = result.functions.find((f) => f.name === "act")!;
    const p = projectFunctionDts(fn, {
      params: [
        { name: "x", abs: num() },
        { name: "s", abs: str() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function act(x: number, s: string)",
    );
    const check = tscNoEmit({
      "mod.d.ts": p.lines.join("\n") + "\n",
      "use.ts": 'import { act } from "./mod.js";\nexport const r = act(undefined, "hello");\n',
    });
    expect(check.ok).toBe(false);
    expect(check.stderr).toContain("TS2345");
  });

  it("负控制：契约覆盖 ⇒ 观测元数不再把契约位标成可选（不裁剪契约义务）", () => {
    const fn = {
      name: "addAll",
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
      paramNames: ["a", "b"],
      cases: [
        { name: "c", argAbs: [num()], abs: neverAbs(), throwsAbs: neverAbs() },
      ],
    } as unknown as Parameters<typeof projectFunctionDts>[0];
    const p = projectFunctionDts(fn, {
      params: [
        { name: "a", abs: num() },
        { name: "b", abs: num() },
      ],
    });
    expect(p.lines.join("\n")).toContain(
      "export declare function addAll(a: number, b: number)",
    );
  });
});
