/**
 * joinObjects 访问器感知回归。
 * 回归背景：joinAbs 对同 key 集的两 obj 臂做结构合并时新建 Abs 身份，
 * 不迁移 accessorTable —— getter 臂的真值域被占位槽（undefined-lit）替代，
 * `{ get q() { return 42; } }` join `{ q: 0 }` 后读 q 得 `undefined | 0`。
 * 修法：混合臂把 getter 结果域并入数据槽；同一访问器定义（别名/迁移产物）
 * 整组迁移到 join 产物，读继续走侧表。每条断言与 Node 真实执行结果对齐。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transpile, formatShape, unknown as unknownAbs, type Abs } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const runtimeUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../exec/index.ts"),
).href;

async function execTranspiled(source: string, exportName: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-eval-join-acc-"));
  dirs.push(dir);
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => Abs;
}

/** 未约束实参 → if 在抽象谓词上 fork → 两臂经 joinAbs 结构合并 */
describe("joinObjects keeps accessor read domains", () => {
  it("getter arm joined with data arm folds getter result into slot", async () => {
    const run = await execTranspiled(
      `export function run(c) {
  let o;
  if (c) { o = { get q() { return 42; } }; } else { o = { q: 0 }; }
  return o.q;
}`,
      "run",
    );
    // 原生：c 真 → 42，c 假 → 0。占位槽 undefined 不得进值域。
    expect(formatShape(run(unknownAbs))).toBe("42 | 0");
  });

  it("getter reading this folds receiver-dependent result", async () => {
    const run = await execTranspiled(
      `export function run(c) {
  let o;
  if (c) { o = { n: 41, get q() { return this.n; } }; } else { o = { n: 1, q: 0 }; }
  return o.q;
}`,
      "run",
    );
    // getter 闭包以原臂为接收者求值：this.n → 41
    expect(formatShape(run(unknownAbs))).toBe("41 | 0");
  });

  it("two different getters join both result domains", async () => {
    const run = await execTranspiled(
      `export function run(c) {
  let o;
  if (c) { o = { get q() { return 42; } }; } else { o = { get q() { return 7; } }; }
  return o.q;
}`,
      "run",
    );
    expect(formatShape(run(unknownAbs))).toBe("42 | 7");
  });

  it("aliased accessor object through branch keeps getter reads exact", async () => {
    const run = await execTranspiled(
      `export function run(c) {
  const src = { n: 5, get q() { return this.n; } };
  let o = src;
  if (c) { o = src; }
  return o.q;
}`,
      "run",
    );
    // 同一访问器定义（同臂身份）→ join 产物迁移侧表，读仍走 getter
    expect(formatShape(run(unknownAbs))).toBe("5");
  });

  it("setter-only arm joined with data arm reads undefined | data (sound baseline)", async () => {
    const run = await execTranspiled(
      `export function run(c) {
  let o;
  if (c) { o = { set q(v) { this.n = v; }, n: 0 }; } else { o = { q: 0 }; }
  return o.q;
}`,
      "run",
    );
    // setter-only 原生读 undefined；占位口径与数据槽一致 → undefined | 0
    expect(formatShape(run(unknownAbs))).toBe("undefined | 0");
  });
});
