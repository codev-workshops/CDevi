export interface Budgets {
  css: number;
  fonts: number;
}
export interface Measurement {
  css: number;
  fonts: number;
  fontFiles: number;
}
export const DEFAULT_BUDGETS: Budgets;
export function measure(): Measurement;
export function check(budgets?: Budgets): Measurement & { failures: string[] };
