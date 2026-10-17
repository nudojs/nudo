/**
 * resolveRelativeModule 的 fs 错误分类：候选探测单次 statSync——不存在按
 * miss；EACCES/EIO 等真实读故障不得静默折叠成候选 miss（跨文件定义跳转
 * 静默失联），console.error 可见后继续下一候选，且不得上抛炸 LSP。
 */
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRelativeModule } from "../symbols.ts";

/** root 对 chmod 000 免疫，真实 EACCES 用例无法生效 */
const isRoot = process.geteuid?.() === 0;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("resolveRelativeModule fs error taxonomy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("miss → undefined，无告警", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-res-miss-"));
    dirs.push(dir);
    expect(resolveRelativeModule("./nope.js", join(dir, "main.js"))).toBeUndefined();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("存在文件 → 命中，无告警", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-res-hit-"));
    dirs.push(dir);
    const dep = join(dir, "dep.js");
    writeFileSync(dep, `export const x = 1;\n`, "utf-8");
    expect(resolveRelativeModule("./dep.js", join(dir, "main.js"))).toBe(dep);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it.runIf(!isRoot)(
    "候选 stat EACCES（父目录 000）→ console.error 可见 + 不上抛 + 结果 miss",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-res-eacces-"));
      dirs.push(dir);
      mkdirSync(join(dir, "locked"));
      writeFileSync(join(dir, "locked", "dep.js"), `export const x = 1;\n`, "utf-8");
      chmodSync(join(dir, "locked"), 0o000);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        let result: string | undefined = "sentinel";
        expect(() => {
          result = resolveRelativeModule("./locked/dep.js", join(dir, "main.js"));
        }).not.toThrow();
        expect(result).toBeUndefined();
        // 每个候选都 EACCES：必须可见（[nudo-lsp] 前缀 + 错误对象带 errno）
        expect(errSpy.mock.calls.length).toBeGreaterThan(0);
        const msg = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
        expect(msg).toContain("[nudo-lsp]");
        expect(msg).toContain("EACCES");
      } finally {
        chmodSync(join(dir, "locked"), 0o755);
      }
      // 解锁后同一路径恢复命中（可见化未改变解析语义）
      expect(resolveRelativeModule("./locked/dep.js", join(dir, "main.js"))).toBe(
        join(dir, "locked", "dep.js"),
      );
    },
  );
});
