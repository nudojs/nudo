// MERGED (topic-related bug pins): cli-bug-044-case-witness-not-published.test.ts + cli-bug-044-export-case-not-contract.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

describe("[merged] cli-bug-044-case-witness-not-published.test.ts", () => {
/**
 * BUG-044 —— `nudo export` 把 `@nudo:case` 的**调试见证**发布成类型 ⇒ 四个
 * 产物面一致地拒绝**实现允许**的调用，且与 `nudo check` 的签名相反。
 *
 * 症状：`/** @nudo:case "dom" (number()) *\/ export function f(x) { return x + 1; }`
 * ⇒ dts `f(x: number): number`、zod `z.number()`、guard `typeof data === "number"`
 * 全被那条调试见证污染；而 `nudo check` 的签名是 `f(x: any) => number | string`
 * （门禁面以 caseMode "none" 调分析器，**永不**产出指令见证）。
 *
 * 修法：export 面与门禁面同口径（caseMode "none"）—— 发布面**不**消费
 * `@nudo:case`（文档：Cases are debug witnesses … not the contract product）。
 *
 * 钉：有 / 无那条调试见证时，dts 与 zod 两个面的投影**逐字相同**，且与
 * `nudo check` 的签名同口径。
 */






const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const BODY = "export function f(x) {\n  return x + 1;\n}\n";
const PLAIN = BODY;
const WITH_WITNESS = `/**\n * @nudo:case "dom" (number())\n */\n${BODY}`;

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b044-"));
  dirs.push(dir);
  writeFileSync(join(dir, "plain.js"), PLAIN, "utf-8");
  writeFileSync(join(dir, "lib.js"), WITH_WITNESS, "utf-8");
  return dir;
}

/** 声明的形参类型（`export declare function f(<这里>): …`）。 */
function dtsParamType(stdout: string): string {
  const m = /^export declare function f\(([^)]*)\)/m.exec(stdout);
  expect(m).not.toBeNull();
  return m![1]!;
}

describe("BUG-044 — `@nudo:case` 调试见证不进发布面", () => {
  it("dts 面：有调试见证与无证据的投影相同（形参是 unknown，不是 number）", () => {
    const dir = fixture();
    const plain = runCliTsx(["export", join(dir, "plain.js"), "--format", "dts"]);
    const withCase = runCliTsx(["export", join(dir, "lib.js"), "--format", "dts"]);
    expect(plain.status).toBe(0);
    expect(withCase.status).toBe(0);

    expect(dtsParamType(withCase.stdout)).toBe(dtsParamType(plain.stdout));
    expect(dtsParamType(withCase.stdout)).toContain("unknown");
    expect(dtsParamType(withCase.stdout)).not.toContain("number");
  }, 60000);

  it("zod / guard 面：放宽到 unknown（不再按那一次调试调用收窄）", () => {
    const dir = fixture();
    const plain = runCliTsx(["export", join(dir, "plain.js"), "--format", "all"]);
    const withCase = runCliTsx(["export", join(dir, "lib.js"), "--format", "all"]);
    expect(withCase.status).toBe(0);

    expect(withCase.stdout).toContain("export const fInput = z.object({ x: z.unknown() })");
    expect(withCase.stdout).not.toContain("x: z.number()");
    // 与无证据的同形源一致
    expect(withCase.stdout).toContain("export const fInput = z.object({ x: z.unknown() })");
    expect(plain.stdout).toContain("export const fInput = z.object({ x: z.unknown() })");
  }, 60000);

  it("与 nudo check 的签名同口径（发布面 = 门禁面）", () => {
    const dir = fixture();
    const check = runCliTsx(["check", join(dir, "lib.js")]);
    const dts = runCliTsx(["export", join(dir, "lib.js"), "--format", "dts"]);
    expect(dts.status).toBe(0);
    // check 签名行：f(x: any) => number | string
    expect(check.stdout).toContain("f(x: any)");
    expect(dtsParamType(dts.stdout)).toContain("unknown");
    expect(dts.stdout).toContain("number | string");
  }, 60000);
});
});

describe("[merged] cli-bug-044-export-case-not-contract.test.ts", () => {
/**
 * BUG-044 — `nudo export` / `nudo contract` 把 `@nudo:case` 的**域形状实参**
 * 发布成类型 ⇒ 发布的 d.ts / schema / guard / 打印面是错的。
 *
 * `@nudo:case` 是**调试见证**（docs/concepts/directives.md:44），不是契约；
 * 门禁面（check / health / mutate）用 `caseMode "none"`，发布面与打印面必须
 * **同口径**。此前 export 与 contract-surface 用 `"all"`
 * ⇒ 同一个函数，仅仅多一条 `@nudo:case "dom" (number())` 就把
 * `f(x: any) => number | string` 变成 `f(x: number) => number`。
 */






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
  it("dts：有 case 与无 case 逐字相同（均门禁口径 x: unknown）", () => {
    const { dir, withCase, plain } = project();
    try {
      const a = dtsSig(runCliTsx(["export", withCase, "--format", "dts"]).stdout);
      const b = dtsSig(runCliTsx(["export", plain, "--format", "dts"]).stdout);
      expect(a).toBe("export declare function f(x: unknown): number | string;");
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
});
