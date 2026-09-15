import { type TypeValue, T } from "@nudojs/core";

export const INTL_DATETIMEFORMAT_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  format: () => T.string,
};

export const INTL_NUMBERFORMAT_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  format: () => T.string,
};

export function createDateTimeFormatType(): TypeValue {
  return T.instanceOf("DateTimeFormat", {});
}

export function createNumberFormatType(): TypeValue {
  return T.instanceOf("NumberFormat", {});
}
