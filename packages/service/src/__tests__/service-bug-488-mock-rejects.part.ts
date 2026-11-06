/**
 * Bug 488 —— `@nudo:mock` 的 **`rejects`** 形态被建模成「返回 never」
 * ⇒ 返回契约**空洞成立**（`never ⊑ string()` ⇒ 假绿，零诊断）
 * + 签名/dts 写出 `never`（错误类型声明）。
 *
 * 修法（族 14 · 分片 I）：`rejects` 建模成「必定 reject 的 promise」
 * （与 `resolves` 分支同形：eff/promise），内层 never = 永不 fulfill。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkSource, formatShape } from "@nudojs/core";
import { parse, extractDirectivesQuiet } from "@nudojs/parser";
import { mockDirectivesToAbsSeeds, mockSeedsToAbsMocks } from "../mock-abs.ts";
import { defaultLoadModule } from "../load-module.ts";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

/** rejects 形态（返回必定 reject 的 promise） */
const REJECTS = `/**
 * @nudo:mock fetch = stub().rejects(new Error("x"))
 */
export function f() {
  return fetch("/x");
}
`;

/** 负控制：resolves 形态（同一契约下本就该 unproven） */
const RESOLVES = `/**
 * @nudo:mock fetch = stub().resolves(42)
 */
export function f() {
  return fetch("/x");
}
`;

/** 负控制：普通 returns 形态（同步返回值，不受本条影响） */
const RETURNS = `/**
 * @nudo:mock fetch = stub().returns(42)
 */
export function f() {
  return fetch("/x");
}
`;

function check(file: string, source: string, entry: string) {
  const mocks = mockSeedsToAbsMocks(
    mockDirectivesToAbsSeeds(extractDirectivesQuiet(parse(source)), { fromFile: entry }),
  );
  return checkSource(entry, source, undefined, {
    inject: { mocks },
    fromFile: entry,
    loadModule: defaultLoadModule,
  });
}

describe("Bug 488 — rejects 形态建模成 reject 的 promise（不是 never）", () => {
  it("返回类型是 promise 面（eff/promise），不是 never", () => {
    const report = check("/tmp/bug488-a.js", REJECTS, "/tmp/bug488-a.js");
    const sig = report.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.abs.shape.k).toBe("eff");
    expect((sig!.abs.shape as { eff?: string }).eff).toBe("promise");
    expect(formatShape(sig!.abs)).not.toBe("never");
  });

  it("返回契约不再被 never 空洞满足（string() 判为不满足 ⇒ 报 unproven-return）", () => {
    const dir = makeTmpProject("nudo-bug488-", {
      "a.js": REJECTS,
      "a.nudo.js": `import { fn, string } from "@nudojs/core";\nexport const f = fn({}, string());\n`,
    });
    const entry = join(dir, "a.js");
    const source = readFileSync(entry, "utf-8");
    const report = check(entry, source, entry);
    const unproven = report.issues.filter((i) => i.code === "nudo:unproven-return");
    expect(unproven.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Bug 488 负控制 —— resolves / returns 形态不受影响", () => {
  it("resolves 形态仍是 promise<42>", () => {
    const report = check("/tmp/bug488-b.js", RESOLVES, "/tmp/bug488-b.js");
    const sig = report.signatures.find((s) => s.name === "f");
    expect(sig!.abs.shape.k).toBe("eff");
    expect(formatShape(sig!.abs)).toContain("42");
  });

  it("returns 形态仍是同步值 42", () => {
    const report = check("/tmp/bug488-c.js", RETURNS, "/tmp/bug488-c.js");
    const sig = report.signatures.find((s) => s.name === "f");
    expect(sig!.abs.shape.k).toBe("prim");
    expect(formatShape(sig!.abs)).toContain("42");
  });

  it("resolves 形态在同契约下同样报 unproven-return（口径一致）", () => {
    const dir = makeTmpProject("nudo-bug488b-", {
      "b.js": RESOLVES,
      "b.nudo.js": `import { fn, string } from "@nudojs/core";\nexport const f = fn({}, string());\n`,
    });
    const entry = join(dir, "b.js");
    const source = readFileSync(entry, "utf-8");
    const report = check(entry, source, entry);
    expect(report.issues.filter((i) => i.code === "nudo:unproven-return").length).toBeGreaterThanOrEqual(1);
  });
});
