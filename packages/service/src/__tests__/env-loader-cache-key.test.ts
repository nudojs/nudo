/**
 * path env 缓存键精度（mtimeMs+size 双值）与 fallback 副本内容指纹。
 *
 * - 键/校验此前只看 mtime：粗 mtime 粒度文件系统上「同秒编辑」→ 旧
 *   defineEnv 工厂陈旧命中，recordPathEnvFile 重登记旧值自我续命。
 * - fallback 副本文件名此前只含 path:mtime：内容变而键不变时 Node/vite
 *   ESM 按同一 URL 命中旧模块，新内容永不生效。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, utimesSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEnvironment, formatShape } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";
import {
  loadEnvsAsync,
  preloadPathEnvs,
  clearPathEnvCaches,
} from "../evaluator/env-loader.ts";

beforeEach(() => {
  clearPathEnvCaches();
});

describe("path env 缓存键双值指纹（mtimeMs+size）", () => {
  it("同 mtime 不同 size → 击穿缓存加载新 defineEnv（非陈旧工厂续命）", async () => {
    const dir = tmpProject("nudo-env-sizekey-");
    const envPath = join(dir, "custom.env.ts");
    const write = (lit: string) =>
      writeFileSync(
        envPath,
        `import { numLit } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: numLit(${lit}) } };
}
`,
        "utf-8",
      );

    write("99");
    const t = new Date("2024-05-05T00:00:00.250Z");
    utimesSync(envPath, t, t); // 钉住 mtime：后续重写后同值
    const l1 = await loadEnvsAsync(["./custom.env.ts"], createEnvironment(), dir);
    expect(formatShape(l1.globals.MAGIC!)).toBe("99");

    // 同 mtime、size 变化（99 → 123456）：键必须 miss → 重新 import
    write("123456");
    utimesSync(envPath, t, t);
    const l2 = await loadEnvsAsync(["./custom.env.ts"], createEnvironment(), dir);
    expect(formatShape(l2.globals.MAGIC!)).toBe("123456");
  });

  it("同 mtime 同 size 同内容 → 命中缓存（不重新 import）", async () => {
    const dir = tmpProject("nudo-env-sizehit-");
    const envPath = join(dir, "custom.env.ts");
    writeFileSync(
      envPath,
      `import { numLit } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: numLit(7) } };
}
`,
      "utf-8",
    );
    const t = new Date("2024-05-05T00:00:00.500Z");
    utimesSync(envPath, t, t);
    const l1 = await loadEnvsAsync(["./custom.env.ts"], createEnvironment(), dir);
    const l2 = await loadEnvsAsync(["./custom.env.ts"], createEnvironment(), dir);
    expect(formatShape(l1.globals.MAGIC!)).toBe("7");
    expect(formatShape(l2.globals.MAGIC!)).toBe("7");
  });
});

describe("path env fallback 副本文件名内容指纹", () => {
  const cacheDir = join(tmpdir(), "nudo-env");
  /** 缓存目录中内容含 marker 的副本文件名（对并行写入鲁棒，不依赖目录 diff） */
  const copiesContaining = (marker: string): string[] => {
    if (!existsSync(cacheDir)) return [];
    return readdirSync(cacheDir).filter((f) => {
      try {
        return readFileSync(join(cacheDir, f), "utf-8").includes(marker);
      } catch {
        return false;
      }
    });
  };

  it("同 path:mtime 不同内容 → 不同副本文件名（URL 随内容变）", async () => {
    const dir = tmpProject("nudo-env-copyhash-");
    const envPath = join(dir, "boom.env.ts");
    const write = (marker: string) =>
      writeFileSync(
        envPath,
        // 顶层 throw：直连 import 必失败 → 走 bare-specifier 重写副本路径；
        // @nudojs/core 说明符可被 rewriteBareImports 重写（rewrote=true）
        `import { numLit } from "@nudojs/core";
throw new Error("boom-${marker}");
export function defineEnv() { return { globals: {} }; }
`,
        "utf-8",
      );

    const t = new Date("2024-05-05T00:00:00.750Z");
    write("v1");
    utimesSync(envPath, t, t);
    await preloadPathEnvs(["./boom.env.ts"], dir); // 副本已写（import 后续失败不影响落盘）
    const copies1 = copiesContaining("boom-v1");
    expect(copies1.length).toBeGreaterThanOrEqual(1);

    write("v2-longer-marker"); // 内容变（size 亦变）
    utimesSync(envPath, t, t); // path 与 mtime 均不变
    await preloadPathEnvs(["./boom.env.ts"], dir);
    const copies2 = copiesContaining("boom-v2");
    expect(copies2.length).toBeGreaterThanOrEqual(1);
    // 内容指纹不同 → 文件名必须不同；旧实现 hash(path:mtime) 会覆写同一文件
    for (const c1 of copies1) {
      for (const c2 of copies2) {
        expect(c1).not.toBe(c2);
      }
    }
  });
});
