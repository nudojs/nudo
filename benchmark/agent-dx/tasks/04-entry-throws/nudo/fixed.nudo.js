import { fn, shape, string } from "@nudojs/core";

export const getName = fn({ user: shape({ name: string() }) }, string());
