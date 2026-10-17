/**
 * evalMockFileWithDeps 的 load 抛错分类：miss（ENOENT / 返回 undefined）与
 * 读失败（EACCES/EIO…带 errno）必须区分——读失败折叠成 not-found 会把
 * 排障方向带偏（权限/IO 问题被当成「文件没写」）。
 * 下游消费方（mock-abs / mock-module）只特判 not-found，read-failed 走
 * 原始 error 文案（含 errno），不被破坏。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { evalMockFileWithDeps } from "../mock-file.ts";
import { tmpProject } from "./tmp-project.ts";

const throwsWith = (code: string) => (): string | undefined => {
  throw Object.assign(new Error(`${code}: permission denied`), { code });
};

describe("evalMockFileWithDeps load error taxonomy", () => {
  it("load 返回 undefined（真 miss）→ not-found", () => {
    const from = join(tmpProject("nudo-mf-miss-"), "main.js");
    const r = evalMockFileWithDeps("./mocks/axios.js", from, () => undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("not-found");
      expect(r.error).toContain("not found");
    }
  });

  it("load 抛 ENOENT → 维持 not-found（竞态删除按 miss）", () => {
    const from = join(tmpProject("nudo-mf-enoent-"), "main.js");
    const r = evalMockFileWithDeps("./mocks/axios.js", from, throwsWith("ENOENT"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("not-found");
      expect(r.error).toContain("not found");
    }
  });

  it("load 抛 EACCES → read-failed，文案带 errno（不得误导成 not-found）", () => {
    const from = join(tmpProject("nudo-mf-eacces-"), "main.js");
    const r = evalMockFileWithDeps("./mocks/axios.js", from, throwsWith("EACCES"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("read-failed");
      expect(r.error).toContain("read failed");
      expect(r.error).toContain("EACCES");
      expect(r.error).not.toContain("not found");
    }
  });

  it("load 抛 EIO → read-failed（非 EACCES 的读故障同口径）", () => {
    const from = join(tmpProject("nudo-mf-eio-"), "main.js");
    const r = evalMockFileWithDeps("./mocks/axios.js", from, throwsWith("EIO"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("read-failed");
      expect(r.error).toContain("EIO");
    }
  });
});
