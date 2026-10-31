/**
 * BUG-044 — `nudo export` / `nudo contract` 把 `@nudo:case` 的**域形状实参**
 * 发布成类型 ⇒ 发布的 d.ts / schema / guard / 打印面是错的。
 *
 * `@nudo:case` 是**调试见证**（docs/concepts/directives.md:44），不是契约；
 * 门禁面（check / health / mutate）用 `caseMode "none"`，发布面与打印面必须
 * **同口径**。此前 export 与 interface-surface 用 `"all"`
 * ⇒ 同一个函数，仅仅多一条 `@nudo:case "dom" (number())` 就把
 * `f(x: any) => number | string` 变成 `f(x: number) => number`。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 有 `@nudo:case` 的模块：`number()` 是**见证实参**，不是入参契约。 */
const WITH_CASE = `/**
 * @nudo:case "dom" (number())
 */
export function f(x) {
  return x + 1;
}
`;

/** 对照组：同函数、删掉那条 case。 */
const PLAIN = `export function f(x) {
  return x + 1;
}
`;

function project(): { dir: string; withCase: string; plain: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug44-"));
  const withCase = join(dir, "lib.js");
  const plain = join(dir, "plain.js");
  writeFileSync(withCase, WITH_CASE);
  writeFileSync(plain, PLAIN);
  return { dir, withCase, plain };
}

/** dts 面里 f 的签名行 */
function dtsSig(stdout: string): string {
  return stdout
    .split("\n")
    .find((l) => /function f\(/.test(l))!
    .trim();
}

describe("BUG-044 — 调试见证不得进入发布/打印面", () => {
  it("dts：有 case 与无 case 逐字相同（均门禁口径 x: any）", () => {
    const { dir, withCase, plain } = project();
    try {
      const a = dtsSig(runCliTsx(["export", withCase, "--format", "dts"]).stdout);
      const b = dtsSig(runCliTsx(["export", plain, "--format", "dts"]).stdout);
      expect(a).toBe("export declare function f(x: any): number | string;");
      expect(a).toBe(b);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("schema：入参是宽松域（z.unknown），不是 case 的 z.number", () => {
    const { dir, withCase } = project();
    try {
      const out = runCliTsx(["export", withCase, "--format", "schema"]).stdout;
      const inputLine = out.split("\n").find((l) => l.includes("fInput"))!;
      expect(inputLine).toContain("z.unknown()");
      expect(inputLine).not.toContain("z.number()");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("guard：入参接受 string（实现允许 f(\"s\")）", () => {
    const { dir, withCase } = project();
    try {
      const out = runCliTsx(["export", withCase, "--format", "guard"]).stdout;
      expect(out).toContain(`typeof data === "string"`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("`nudo contract` 打印面与 check 同口径（x: any）", () => {
    const { dir, withCase, plain } = project();
    try {
      const sigOf = (out: string): string =>
        out.split("\n").find((l) => /^\s+f\s+\[/.test(l))!.trim();
      const a = sigOf(runCliTsx(["contract", withCase]).stdout);
      const b = sigOf(runCliTsx(["contract", plain]).stdout);
      expect(a).toContain("(x: any)");
      expect(a).not.toContain("(x: number)");
      expect(a).toBe(b);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
