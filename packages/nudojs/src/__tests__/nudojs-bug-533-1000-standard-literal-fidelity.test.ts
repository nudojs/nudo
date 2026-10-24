/**
 * Bug 533 / Bug 1000 —— `nudo export --format standard` 的**产品面**回归。
 *
 * 修前：standard 节点经 `JSON.stringify` 落地 ⇒ `Infinity` 静默变 `null` ⇒
 * 导出的校验器**拒绝函数必返的值**、**放行函数永不返回的 `null`**（schema 与
 * 函数完全反向）；bigint 字面量则让整条 export **崩溃、零产物**（`--format all`
 * 下四个方言的产物一起丢）。
 *
 * 修后：节点走保真序列化 ⇒ 产物放行 `Infinity`、拒绝 `null`；bigint 契约的
 * export 不再崩溃（四个方言的产物都在）。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runCliNode as runCli } from "./helpers/run-cli.ts";

type StdExport = {
  "~standard": {
    validate(value: unknown): {
      value?: unknown;
      issues?: ReadonlyArray<{ message?: string }>;
    };
  };
};

describe("nudojs Bug 533 / 1000: standard 产物的字面量保真", () => {
  it("export --format standard：Infinity 放行、null 拒绝（不再折成 null）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-standard-inf-"));
    const file = join(dir, "divzero.js");
    writeFileSync(
      file,
      "export function divZero() { return 1 / 0; }\nexport function okNum() { return 42; }\n",
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "standard", "--out", out]);
    expect(r.status).toBe(0);

    const p = join(out, "divZero.nudo.standard.ts");
    expect(existsSync(p)).toBe(true);
    const body = readFileSync(p, "utf-8");
    // 修前：{"k":"lit","value":null}
    expect(body).toContain('"value":Infinity');
    expect(body).not.toContain('"value":null');

    const mod = (await import(pathToFileURL(p).href)) as unknown as Record<string, StdExport>;
    const validate = mod.divZeroOutput!["~standard"].validate;
    expect(validate(Infinity).issues).toBeUndefined();
    const nul = validate(null);
    expect(nul.issues).toBeDefined();
    expect(nul.issues?.[0]?.message).toContain("expected Infinity");
  });

  it("export --format all：bigint 字面量契约不再让整条命令崩溃（零产物）", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-standard-big-"));
    const file = join(dir, "big.js");
    writeFileSync(file, "export function bigAdd(a) { return a; }\n", "utf-8");
    writeFileSync(
      join(dir, "big.nudo.js"),
      // 侧车的契约形参名必须与函数形参表一致（`bigAdd(a)` ⇒ `a`）：写成 `n` 时
      // `nudo check` 判 `nudo:interface-param-mismatch`（error）⇒ 导出面按契约
      // 一致性闸门拒绝发布产物（Bug 607）。
      'import { fn, lit } from "@nudojs/core";\nexport const bigAdd = fn({ a: lit(10n) }, lit(10n));\n',
      "utf-8",
    );
    const out = join(dir, "out");
    const r = runCli(["export", file, "--format", "all", "--out", out]);
    // 修前：exit 1 +「Do not know how to serialize a BigInt」+ 产物 0 个
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("Do not know how to serialize a BigInt");
    // 四个方言的产物都在（standard 面不再连坐其它方言）
    expect(existsSync(join(out, "big.nudo.schema.zod.ts"))).toBe(true);
    expect(existsSync(join(out, "big.nudo.guard.ts"))).toBe(true);
    expect(existsSync(join(out, "big.d.ts"))).toBe(true);
    const std = join(out, "bigAdd.nudo.standard.ts");
    expect(existsSync(std)).toBe(true);
    expect(readFileSync(std, "utf-8")).toContain('"value":10n');
  });
});
