/**
 * Bug 934：`package.json#nudo.env` 的值**不是数组**时的处理。
 *
 * 旧实现：消费点 `projectEnvNames is not iterable` ⇒ check / test / health /
 * contract / export **五个 verb 全部裸崩**（不是 Nudo 报告）。
 *
 * 现状（HEAD）：配置层已回落默认（[]）并给一条 stderr 提示（族 14 的 935），
 * 裸崩已消失——但**报告面**仍看不到这件事（用户只看到「env 没生效」的现象），
 * 且消费点没有显式守卫。本测试钉住：
 * - 消费点守卫：非数组 ⇒ 回落默认，门禁照跑（不裸崩）；
 * - 报告面可见：人类面与 `--json` 面都有一条**带文件名 + 诊断码**
 *   （`config-shape`，与既有的 nudo 键形状诊断同口径）的告警。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const SRC = `export function b() {
  return 1 + 1;
}
`;

function makeProject(envJson: string): { cwd: string; file: string; pkg: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-934-envshape-"));
  const file = join(dir, "t.js");
  writeFileSync(file, SRC, "utf-8");
  const pkg = join(dir, "package.json");
  writeFileSync(
    pkg,
    `{"name":"env-proj","version":"0.0.0","type":"module","nudo":{"env":${envJson}}}\n`,
    "utf-8",
  );
  return { cwd: dir, file, pkg };
}

describe("Bug 934 — package.json#nudo.env 非数组：原生报告而非裸崩", () => {
  it("人类面：exit 0（不裸崩）+ 报告面有文件名与诊断码 config-shape", () => {
    const { cwd, file, pkg } = makeProject("42");
    try {
      const r = runCliTsx(["check", file], { cwd });
      // 不裸崩
      expect(r.stderr).not.toContain("is not iterable");
      expect(r.status).toBe(0);
      // 报告面：文件名 + 诊断码（与 468/936 的 config-shape 同口径）
      expect(r.stdout).toContain("config-shape");
      expect(r.stdout).toContain(pkg);
      expect(r.stdout).toContain('"nudo.env"');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("机器面（--json）：issues 里有 config-shape 告警（文件名 + 值）", () => {
    const { cwd, file, pkg } = makeProject("42");
    try {
      const r = runCliTsx(["check", file, "--json"], { cwd });
      expect(r.status).toBe(0);
      const j = JSON.parse(r.stdout) as {
        ok: boolean;
        issues: Array<{ severity: string; code: string; message: string }>;
      };
      const shape = j.issues.find((i) => i.code === "config-shape");
      expect(shape).toBeDefined();
      expect(shape!.severity).toBe("warning");
      expect(shape!.message).toContain(pkg);
      expect(shape!.message).toContain("42");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("其它形状（布尔 / 对象）同样不裸崩 + 报告面可见", () => {
    for (const envJson of ["true", '{"a":1}']) {
      const { cwd, file, pkg } = makeProject(envJson);
      try {
        const r = runCliTsx(["check", file], { cwd });
        expect(r.stderr).not.toContain("is not iterable");
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("config-shape");
        expect(r.stdout).toContain(pkg);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }
  });

  it("合法 env 数组：无 config-shape 告警（未回归）", () => {
    const { cwd, file } = makeProject('["node"]');
    try {
      const r = runCliTsx(["check", file], { cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("config-shape");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
