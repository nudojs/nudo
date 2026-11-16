/**
 * dts 产物面的 **tsc 实测** harness（族 15 专用）。
 *
 * 产物面条目（dts / zod / standard / guard）必须真的能被
 * `tsc --noEmit --strict` 编译——只比字符串抓不到 TS2314（缺类型实参）/
 * TS1359（保留字）/ TS2571（unknown 上的方法调用）/ TS2339（空对象属性读）/
 * TS2488（不可迭代）这些症状。
 *
 * 实现走 **进程内 TS 编译器 API**（`ts.createProgram` + `getPreEmitDiagnostics`），
 * 与 `tsc --noEmit --strict --ignoreConfig <files>` 同口径：不读任何 tsconfig、
 * 同名文件一起进 program（相对 import 可解析）。原先每次 `pnpm exec tsc`
 * 都要付一次 node 启动 + 2.4s（全仓 100+ 次调用 ≈ 250s CPU）；进程内稳态
 * ≈0.15s/次，诊断文本仍是 `x.ts(1,2): error TSxxxx: …`（断言只匹配 TS 码）。
 *
 * 独立文件（不塞进共享 `fixtures.ts`）：避免与并发分片在共享夹具里撞同名
 * 导出（重复导出会让所有引用它的文件一起编译失败）。
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { tmpProject } from "../../__tests__/tmp-project.ts";

export type TscResult = { ok: boolean; stderr: string };

const FORMAT_HOST: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => process.cwd(),
  getCanonicalFileName: (f) => f,
  getNewLine: () => "\n",
};

/** 跑一个 strict program，只把 error 级诊断算失败（tsc 退出码同口径）。 */
function runProgram(fileNames: string[], options: ts.CompilerOptions): TscResult {
  const program = ts.createProgram(fileNames, {
    noEmit: true,
    strict: true,
    ...options,
  });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
  return {
    ok: diagnostics.length === 0,
    stderr: diagnostics.length === 0 ? "" : ts.formatDiagnostics(diagnostics, FORMAT_HOST),
  };
}

/** 把给定文件写进临时工程并跑 `tsc --noEmit --strict`（真编译）。 */
export function tscNoEmit(
  files: Record<string, string>,
  options: ts.CompilerOptions = {},
): TscResult {
  const dir = tmpProject("nudo-dts-tsc-");
  const paths: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    writeFileSync(p, content.endsWith("\n") ? content : content + "\n", "utf-8");
    paths.push(p);
  }
  return runProgram(paths, options);
}

/**
 * 单文件夹具：与 `tsc --noEmit --strict --skipLibCheck --ignoreConfig` 同口径
 * （`skipLibCheck` 是既有单文件 helper 的口径，保持不动）。默认 `.d.ts`；
 * 守卫产物等 `.ts` 源显式给 `fileName`。
 */
export function tscNoEmitSingle(source: string, fileName = "mod.d.ts"): TscResult {
  return tscNoEmit({ [fileName]: source }, { skipLibCheck: true });
}

/**
 * tsconfig 形态：夹具需要 `paths` / `moduleResolution` 等解析选项时，逐字
 * 复用测试写出的 tsconfig.json（等价 `tsc --noEmit -p <tsconfig>`）。
 */
export function tscNoEmitConfig(tsconfigPath: string): TscResult {
  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  });
  if (!parsed) return { ok: false, stderr: `failed to read ${tsconfigPath}` };
  return runProgram(parsed.fileNames, parsed.options);
}
