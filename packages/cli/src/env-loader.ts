import { type TypeValue, type Environment } from "@nudojs/core";
import { defineEnv as defineEsEnv } from "@nudojs/env-es";
import { defineEnv as defineWebEnv } from "@nudojs/env-web";
import { defineEnv as defineNodeEnv } from "@nudojs/env-node";

type EnvDefinition = {
  globals: Record<string, TypeValue>;
  modules?: Record<string, Record<string, TypeValue>>;
};

const envFactories: Record<string, () => EnvDefinition> = {
  es: defineEsEnv,
  web: defineWebEnv,
  node: defineNodeEnv,
};

const impliedDeps: Record<string, string[]> = {
  web: ["es"],
  node: ["es"],
};

function resolveEnvNames(names: string[]): string[] {
  const resolved = new Set<string>();
  const visit = (name: string) => {
    if (resolved.has(name)) return;
    const deps = impliedDeps[name];
    if (deps) deps.forEach(visit);
    resolved.add(name);
  };
  names.forEach(visit);
  return [...resolved];
}

export type LoadedEnv = {
  modules: Record<string, Record<string, TypeValue>>;
};

export function loadEnvs(envNames: string[], globalEnv: Environment): LoadedEnv {
  const allModules: Record<string, Record<string, TypeValue>> = {};
  const resolved = resolveEnvNames(envNames);

  for (const name of resolved) {
    const factory = envFactories[name];
    if (!factory) continue;
    const def = factory();

    for (const [key, value] of Object.entries(def.globals)) {
      globalEnv.bind(key, value);
    }

    if (def.modules) {
      for (const [modName, exports] of Object.entries(def.modules)) {
        allModules[modName] = { ...allModules[modName], ...exports };
      }
    }
  }

  return { modules: allModules };
}
