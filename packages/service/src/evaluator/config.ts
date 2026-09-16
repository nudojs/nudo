import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

export type NudoConfig = {
  env?: string[];
  mocks?: Record<string, string>;
  interface?: {
    /** 侧车 ambient 绑定总开关（check/LSP 执法与 interface 打印共用） */
    autoBind?: boolean;
  };
};

export type InterfaceConfig = {
  autoBind: boolean;
};

/**
 * 归一化 `nudo.interface` 配置段：autoBind 默认 true。
 * （emit/ignore 白名单键随 Phase 2 root 推导落地时再引入——不留未接线的
 * 声明面，用户写了会被静默忽略。）
 */
export function interfaceConfig(config: NudoConfig | null | undefined): InterfaceConfig {
  return {
    autoBind: config?.interface?.autoBind ?? true,
  };
}

export function findProjectConfig(startDir: string): { config: NudoConfig; projectDir: string } | null {
  let dir = resolve(startDir);
  const root = resolve("/");

  // 向上查找带 `nudo` 键的 package.json。子包自有 package.json（monorepo
  // packages/*）时**不**在此停步——否则仓库根的 nudo.interface.autoBind
  // 对该子包完全不可见。
  while (dir !== root) {
    const pkgPath = resolve(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.nudo) {
          return { config: pkg.nudo as NudoConfig, projectDir: dir };
        }
      } catch {
        // ignore parse errors
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
