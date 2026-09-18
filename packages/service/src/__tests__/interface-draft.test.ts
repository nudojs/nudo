/**
 * `nudo interface --draft`（service/interface-draft.ts）：
 * 从已有逻辑生成可审阅契约草稿——callsite 投影 / symbolic 兜底 /
 * handwritten 跳过 / *.nudo.draft.js 不 ambient 绑定。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectiveInterface } from "@nudojs/core";
import {
  draftInterface,
  formatDraftSummary,
  sidecarDraftPath,
  writeInterfaceDraft,
  collectParamBodyAccesses,
} from "../interface-draft.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-draft-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CALLS_JS = `export function double(x) {
  return x * 2;
}

double(21);
`;

const HANDWRITTEN = `import { fn, number } from "@nudojs/core";

export const double = fn({ x: number().gt(0) }, number());
`;

describe("draftInterface", () => {
  it("projects call-site evidence into draft DSL", async () => {
    const file = join(dir, "calls.js");
    writeFileSync(file, CALLS_JS);
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "double");
    expect(entry).toBeDefined();
    expect(entry!.skipped).toBeUndefined();
    expect(entry!.paramEvidence).toBe("callsite");
    expect(entry!.dsl).toContain("fn({");
    expect(entry!.dsl).toContain("x:");
    // callsite 观测 double(21) 不得变成 lit 硬义务
    expect(entry!.dsl).not.toContain("21");
    expect(r.draftSource).toContain("@nudo:draft");
    expect(r.draftSource).toContain("export const double = ");
    expect(r.draftSource).toContain("NOT loaded as a sidecar");
  });

  it("does not write body-evidence return as DSL obligation", async () => {
    const file = join(dir, "bodyret.js");
    writeFileSync(
      file,
      `export function id(x) { return x; }\n`,
    );
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "id");
    expect(entry).toBeDefined();
    // 无 callsite/directive：返回位不得 projected 进 DSL 义务
    if (entry!.returns) {
      expect(entry!.returns.projected).toBe(false);
    }
  });

  it("skips handwritten contracts (never overwrite)", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, CALLS_JS);
    writeFileSync(join(dir, "lib.nudo.js"), HANDWRITTEN);
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "double");
    expect(entry!.skipped).toBe("handwritten");
    expect(entry!.dsl).toBeUndefined();
    expect(r.draftSource).toContain("Skipped:");
    expect(r.draftSource).toContain("double (handwritten)");
    // 草稿正文不覆盖手写导出
    expect(r.draftSource).not.toMatch(/^export const double = /m);
  });

  it("entry-only export still gets a draft skeleton (no invented obligations)", async () => {
    const file = join(dir, "lonely.js");
    writeFileSync(file, `export function lonely(y) {\n  return y;\n}\n`);
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "lonely");
    expect(entry).toBeDefined();
    expect(entry!.paramEvidence).toBe("none");
    expect(entry!.params[0]!.projected).toBe(false);
    // DSL 省略无证据参数槽，不发明 y: …
    expect(entry!.dsl).toBe("fn({})");
    expect(r.draftSource).toContain("no evidence");
  });

  it("filters by fnNames", async () => {
    const file = join(dir, "multi.js");
    writeFileSync(
      file,
      `export function a(x) { return x; }\nexport function b(x) { return x * 2; }\na(1);\nb(2);\n`,
    );
    const r = await draftInterface(file, { fnNames: ["b"] });
    expect(r.entries.map((e) => e.fn)).toEqual(["b"]);
  });

  it("sidecarDraftPath is *.nudo.draft.js and is not ambient-loaded", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, CALLS_JS);
    expect(sidecarDraftPath(file)).toBe(join(dir, "lib.nudo.draft.js"));

    const r = await draftInterface(file);
    const w = writeInterfaceDraft(file, r.draftSource);
    expect(w.written).toBe(true);
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(true);
    // 正式侧车未创建 — check/effectiveInterface 不会吃到草稿
    expect(existsSync(join(dir, "lib.nudo.js"))).toBe(false);
    const loadModule = () => undefined;
    const eff = effectiveInterface(CALLS_JS, "double", {
      loadModule,
      fromFile: file,
    });
    expect(eff).toBeUndefined();
  });

  it("write is idempotent; dryRun does not write", async () => {
    const file = join(dir, "lib.js");
    writeFileSync(file, CALLS_JS);
    const r = await draftInterface(file);
    const dry = writeInterfaceDraft(file, r.draftSource, { dryRun: true });
    expect(dry.changed).toBe(true);
    expect(dry.written).toBe(false);
    expect(existsSync(join(dir, "lib.nudo.draft.js"))).toBe(false);

    const w1 = writeInterfaceDraft(file, r.draftSource);
    expect(w1.written).toBe(true);
    const w2 = writeInterfaceDraft(file, r.draftSource);
    expect(w2.changed).toBe(false);
    expect(w2.written).toBe(false);
  });

  it("formatDraftSummary prints DSL lines and write path", async () => {
    const file = join(dir, "calls.js");
    writeFileSync(file, CALLS_JS);
    const r = await draftInterface(file);
    const text = formatDraftSummary("calls.js", "calls.nudo.draft.js", r).join("\n");
    expect(text).toContain("double");
    expect(text).toContain("draft callsite/");
    const write = writeInterfaceDraft(file, r.draftSource);
    const text2 = formatDraftSummary("calls.js", "calls.nudo.draft.js", r, write).join("\n");
    expect(text2).toContain("Draft written →");
  });

  it("body accesses appear as draft suggestions only (not check obligations)", async () => {
    const file = join(dir, "greet.js");
    writeFileSync(
      file,
      `export function greet(user) {\n  return "hi " + user.name;\n}\n`,
    );
    const map = collectParamBodyAccesses(readFileSync(file, "utf-8"));
    expect(map.get("greet")?.get("user")?.has("name")).toBe(true);

    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "greet");
    expect(entry!.paramEvidence).toBe("body");
    expect(entry!.params[0]!.bodyAccesses).toEqual(["name"]);
    // DSL 不发明 shape({ name }) 义务，仅注释建议
    expect(entry!.dsl).toBe("fn({})");
    expect(r.draftSource).toContain("body-read { name }");
    expect(r.draftSource).toContain("suggested (body-read, not a contract)");
    expect(r.draftSource).toContain("export const greet = fn({});");
  });

  it("bodyAccesses:false disables body suggestions", async () => {
    const file = join(dir, "greet.js");
    writeFileSync(
      file,
      `export function greet(user) {\n  return "hi " + user.name;\n}\n`,
    );
    const r = await draftInterface(file, { bodyAccesses: false });
    const entry = r.entries.find((e) => e.fn === "greet");
    expect(entry!.paramEvidence).toBe("none");
    expect(entry!.params[0]!.bodyAccesses).toBeUndefined();
  });

  it("skips handwritten sidecar even when project autoBind=false", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "nudo-draft-ab-"));
    try {
      writeFileSync(
        join(dir2, "package.json"),
        JSON.stringify({ name: "ab", nudo: { interface: { autoBind: false } } }),
      );
      const file = join(dir2, "lib.js");
      writeFileSync(file, CALLS_JS);
      writeFileSync(
        join(dir2, "lib.nudo.js"),
        `import { fn, number } from "@nudojs/core";\nexport const double = fn({ x: number().gt(0) }, number());\n`,
      );
      // 产品语义：draft 探测「契约是否存在」，不跟 ambient autoBind 走
      const off = await draftInterface(file);
      const offEntry = off.entries.find((e) => e.fn === "double");
      expect(offEntry!.skipped).toBe("handwritten");

      const on = await draftInterface(file, { autoBind: true });
      const onEntry = on.entries.find((e) => e.fn === "double");
      expect(onEntry!.skipped).toBe("handwritten");
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it("returnCases fallback without callsite/directive stays body/none (not directive)", async () => {
    const file = join(dir, "bodyonly.js");
    writeFileSync(
      file,
      `export function pick(cfg) {\n  return cfg.mode;\n}\n`,
    );
    const r = await draftInterface(file);
    const entry = r.entries.find((e) => e.fn === "pick");
    expect(entry).toBeDefined();
    expect(["body", "none", "symbolic"]).toContain(entry!.returnEvidence);
    expect(entry!.returnEvidence).not.toBe("callsite");
    expect(entry!.returnEvidence).not.toBe("directive");
    expect(entry!.paramEvidence).not.toBe("directive");
  });
});
