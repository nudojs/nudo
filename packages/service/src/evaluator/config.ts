import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

export type NudoConfig = {
  env?: string[];
  mocks?: Record<string, string>;
  interface?: {
    autoBind?: boolean;
    emit?: string[];
    ignore?: string[];
  };
};

export type InterfaceConfig = {
  autoBind: boolean;
  emit: string[];
  ignore: string[];
};

/** 归一化 `nudo.interface` 配置段：autoBind 默认 true，数组默认 []。 */
export function interfaceConfig(config: NudoConfig | null | undefined): InterfaceConfig {
  const iface = config?.interface;
  const emit = iface?.emit;
  const ignore = iface?.ignore;
  return {
    autoBind: iface?.autoBind ?? true,
    emit: Array.isArray(emit) ? [...emit] : [],
    ignore: Array.isArray(ignore) ? [...ignore] : [],
  };
}

export function findProjectConfig(startDir: string): { config: NudoConfig; projectDir: string } | null {
  let dir = resolve(startDir);
  const root = resolve("/");

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
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
