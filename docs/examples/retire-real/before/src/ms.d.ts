/** 最小 @types/ms 形态（真实包无自带 .d.ts 时消费方声明） */
declare module "ms" {
  function ms(value: string): number;
  function ms(value: number, options?: { long?: boolean }): string;
  export default ms;
}
