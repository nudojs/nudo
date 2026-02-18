import { type TypeValue, T } from "./type-value.ts";

export type Environment = {
  lookup(name: string): TypeValue;
  bind(name: string, value: TypeValue): Environment;
  extend(bindings: Record<string, TypeValue>): Environment;
  has(name: string): boolean;
  snapshot(): Environment;
};

export function createEnvironment(
  parent?: Environment,
  bindings: Map<string, TypeValue> = new Map(),
): Environment {
  const store = new Map(bindings);

  const env: Environment = {
    lookup(name) {
      const val = store.get(name);
      if (val !== undefined) return val;
      if (parent) return parent.lookup(name);
      return T.undefined;
    },

    bind(name, value) {
      store.set(name, value);
      return env;
    },

    extend(newBindings) {
      const childMap = new Map<string, TypeValue>();
      for (const [k, v] of Object.entries(newBindings)) {
        childMap.set(k, v);
      }
      return createEnvironment(env, childMap);
    },

    has(name) {
      return store.has(name) || (parent?.has(name) ?? false);
    },

    snapshot() {
      const clonedStore = new Map(store);
      const clonedParent = parent?.snapshot();
      return createEnvironment(clonedParent, clonedStore);
    },
  };

  return env;
}
