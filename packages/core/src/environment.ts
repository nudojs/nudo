import type { Abs } from "./algebra/abs.ts";
import { unknown as absUnknown } from "./algebra/abs.ts";

export type Environment = {
  lookup(name: string): Abs;
  bind(name: string, value: Abs): Environment;
  update(name: string, value: Abs): boolean;
  extend(bindings: Record<string, Abs>): Environment;
  fork(): Environment;
  has(name: string): boolean;
  snapshot(): Environment;
  getOwnBindings(): Record<string, Abs>;
};

export function createEnvironment(
  parent?: Environment,
  bindings: Map<string, Abs> = new Map(),
): Environment {
  const store = new Map(bindings);

  const env: Environment = {
    lookup(name) {
      const val = store.get(name);
      if (val !== undefined) return val;
      if (parent) return parent.lookup(name);
      return absUnknown;
    },

    bind(name, value) {
      store.set(name, value);
      return env;
    },

    update(name, value) {
      if (store.has(name)) {
        store.set(name, value);
        return true;
      }
      if (parent) return parent.update(name, value);
      return false;
    },

    extend(newBindings) {
      const childMap = new Map<string, Abs>();
      for (const [k, v] of Object.entries(newBindings)) {
        childMap.set(k, v);
      }
      return createEnvironment(env, childMap);
    },

    fork() {
      return createEnvironment(env);
    },

    has(name) {
      return store.has(name) || (parent?.has(name) ?? false);
    },

    snapshot() {
      const clonedStore = new Map(store);
      const clonedParent = parent?.snapshot();
      return createEnvironment(clonedParent, clonedStore);
    },

    getOwnBindings() {
      const result: Record<string, Abs> = {};
      for (const [k, v] of store) {
        result[k] = v;
      }
      return result;
    },
  };

  return env;
}
