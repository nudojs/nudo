/**
 * Bug 582 — `nudo migrate verify --with-tsc` 的 tsc 基线**不带任何信号**。
 *
 * 根因：源文件被当**位置参数**传给 tsc ⇒ 现代 TS 见到「命令行给了文件 + 目录里
 * 有 tsconfig.json」直接拒绝（TS5112）⇒ 干净文件与有错文件的基线**逐字相同**；
 * 且 `opts.root` 从未由 CLI 传入 ⇒ cwd 是**进程 cwd** ⇒ 连 tsconfig 都定位不对。
 *
 * 判据：基线必须**真的加载 tsconfig**（`-p`）并携带**与被检文件相关**的诊断 ⇒
 * 干净文件与有错文件的基线必须不同。
 *
 * 夹具放在仓库的 tmp/ 下（gitignored）：`pnpm exec tsc` 需要能解析到
 * node_modules/.bin/tsc（仓库根已装 typescript）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runCliTsx, repoRoot } from "./helpers/run-cli.ts";

const dir = join(repoRoot, "tmp", `nudo-migrate-582-${process.pid}`);
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
    },
    include: ["*.ts"],
  }),
  "utf-8",
);
/** 干净文件 */
writeFileSync(
  join(dir, "clean.ts"),
  "export function addOne(x: number): number {\n  return x + 1;\n}\n",
  "utf-8",
);
/** 真实类型错误（strict 下 `x` 可能 undefined） */
writeFileSync(
  join(dir, "bad.ts"),
  "export function maybeStr(x: string | undefined): string {\n  return x.toUpperCase();\n}\n",
  "utf-8",
);

type Row = {
  file: string;
  nudoOk: boolean;
  tsc?: { ok: boolean; output: string };
};

describe("migrate verify --with-tsc — tsc 基线带信号（Bug 582）", () => {
  it("基线加载 tsconfig：干净文件与有错文件的诊断不同", { timeout: 300_000 }, () => {
    const r = runCliTsx(["migrate", "verify", "--with-tsc", dir, "--json"]);
    const rows = JSON.parse(r.stdout) as Row[];
    const clean = rows.find((x) => x.file.endsWith("clean.ts"));
    const bad = rows.find((x) => x.file.endsWith("bad.ts"));
    expect(clean).toBeDefined();
    expect(bad).toBeDefined();
    expect(clean!.tsc).toBeDefined();
    expect(bad!.tsc).toBeDefined();

    // 旧行为：两条基线逐字相同（都是 TS5112「tsconfig 不会被加载」）
    expect(clean!.tsc!.output).not.toContain("TS5112");
    expect(bad!.tsc!.output).not.toContain("TS5112");

    // 有错文件：基线带**该文件**的真实诊断
    expect(bad!.tsc!.ok).toBe(false);
    expect(bad!.tsc!.output).toContain("TS18048");
    expect(bad!.tsc!.output).toContain("bad.ts");

    // 干净文件：基线无诊断 ⇒ 与有错文件的基线**必然不同**
    expect(clean!.tsc!.ok).toBe(true);
    expect(clean!.tsc!.output).not.toBe(bad!.tsc!.output);
  });

  it("文本面：干净文件显示 tsc: ok，有错文件显示 tsc: diagnostics", { timeout: 300_000 }, () => {
    const r = runCliTsx(["migrate", "verify", "--with-tsc", dir]);
    expect(r.stdout).toContain("tsc: diagnostics");
    expect(r.stdout).toContain("tsc: ok");
    expect(r.stdout).toContain("TS18048");
  });
});
