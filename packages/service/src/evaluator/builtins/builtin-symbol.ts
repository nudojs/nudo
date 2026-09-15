import { type TypeValue, T } from "@nudojs/core";

export const SYMBOL_STATIC_METHODS: Record<string, TypeValue> = {
  for: T.symbol,
  keyFor: T.union(T.string, T.undefined),
};

export const SYMBOL_STATIC_PROPS: Record<string, TypeValue> = {
  asyncIterator: T.symbol,
  iterator: T.symbol,
  toPrimitive: T.symbol,
  toStringTag: T.symbol,
  hasInstance: T.symbol,
  species: T.symbol,
  isConcatSpreadable: T.symbol,
};
