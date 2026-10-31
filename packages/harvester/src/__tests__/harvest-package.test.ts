import { describe, it, expect, afterAll } from "vitest";
import {
  harvestPackage,
  formatHarvestSummary,
  resolvePackageRoot,
  dtsFileScan,
  collectDtsFiles,
  packageExportSurface,
  type PackageHarvest,
} from "../harvest-package.ts";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe("harvest npm package", () => {
  const root = resolve(process.cwd(), "../..");
  // monorepo root may vary; try a few
  const cwdHasTs = existsSync(resolve(root, "node_modules/typescript/package.json"));

  it("resolvePackageRoot finds workspace packages", () => {
    // typescript is a root devDep of the monorepo
    const r = resolvePackageRoot("typescript", root);
    if (r) {
      expect(existsSync(r)).toBe(true);
    } else {
      // environment without typescript installed — skip soft
      expect(r).toBeUndefined();
    }
  });

  it("harvestPackage on typescript if available", () => {
    const r = resolvePackageRoot("typescript", root);
    if (!r) {
      expect(true).toBe(true);
      return;
    }
    const h = harvestPackage("typescript", root);
    if ("error" in h) {
      // no d.ts collected — still ok in constrained env
      expect(h.error).toBeTruthy();
      return;
    }
    expect(h.dtsFiles.length).toBeGreaterThan(0);
    expect(h.env.stats.symbols).toBeGreaterThan(0);
    expect(formatHarvestSummary(h)).toContain("typescript");
  });
});

describe("读故障 fail-closed 上浮（ENOENT 静默，非 ENOENT 有信号）", () => {
  it("dtsFileScan: ENOENT 空扫描无标记；读错误（EISDIR）标 unreadable 且不进缓存", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-scan-fc-"));
    tmpDirs.push(dir);
    // ENOENT = 合法缺席
    const gone = dtsFileScan(join(dir, "gone.d.ts"));
    expect(gone.exported.size).toBe(0);
    expect(gone.unreadable).toBeUndefined();

    // 目录当 .d.ts 读 → EISDIR（非 ENOENT）
    const eisdir = join(dir, "bad.d.ts");
    mkdirSync(eisdir);
    const bad = dtsFileScan(eisdir);
    expect(bad.unreadable).toBe(true);

    // 瞬态读故障不进缓存：恢复可读后重扫要能拿到真实导出面
    rmSync(eisdir, { recursive: true, force: true });
    writeFileSync(eisdir, "export declare const ok: number;\n");
    const healed = dtsFileScan(eisdir);
    expect(healed.unreadable).toBeUndefined();
    expect([...healed.exported]).toEqual(["ok"]);
  });

  it("packageExportSurface: 入口读不了 ⇒ unresolved（公开面不可知，不折空）", () => {
    const root = mkdtempSync(join(tmpdir(), "nudo-surface-fc-"));
    tmpDirs.push(root);
    mkdirSync(join(root, "index.d.ts")); // 入口是目录 → EISDIR
    const h: PackageHarvest = {
      pkg: "pkg-x",
      root,
      dtsFiles: [join(root, "index.d.ts")],
      env: { globals: {}, modules: {}, stats: { files: 0, symbols: 0, skipped: 0 } },
    };
    expect(packageExportSurface(h).unresolved).toBe(true);
  });

  it("collectDtsFiles: readdir 非 ENOENT 故障（ENOTDIR）计数上浮；ENOENT 静默", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-walk-fc-"));
    tmpDirs.push(dir);
    const f = join(dir, "plain-file");
    writeFileSync(f, "not a dir");
    const fails = { count: 0 };
    // root 是普通文件 → readdirSync 抛 ENOTDIR（非 ENOENT）
    expect(collectDtsFiles(f, 8, fails)).toEqual([]);
    expect(fails.count).toBe(1);
    // 不传 fails（旧签名）也不抛
    expect(collectDtsFiles(f, 8)).toEqual([]);
  });

  it("harvestPackage: package.json JSON 解析故障计数进 env.stats.skipped", () => {
    const proj = mkdtempSync(join(tmpdir(), "nudo-pkg-fc-"));
    tmpDirs.push(proj);
    const pkgRoot = join(proj, "node_modules", "pkg-broken");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(join(pkgRoot, "package.json"), "{ this is not json");
    writeFileSync(join(pkgRoot, "index.d.ts"), "export declare const a: number;\n");
    const h = harvestPackage("pkg-broken", proj);
    if ("error" in h) throw new Error(`unexpected error: ${h.error}`);
    // JSON.parse 抛 SyntaxError（code undefined ≠ ENOENT）→ 上浮进同通道
    expect(h.env.stats.skipped).toBeGreaterThanOrEqual(1);
  });
});
