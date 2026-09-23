declare module "@babel/generator" {
  export function generate(
    ast: unknown,
    opts?: Record<string, unknown>,
    code?: string,
  ): { code: string };
  const _default: { generate: typeof generate };
  export default _default;
}
