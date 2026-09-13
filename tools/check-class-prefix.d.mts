export interface ClassProblem {
  file: string;
  line: number;
  cls: string;
  suggestions: string[];
}
export function definedClasses(): Set<string>;
export function scan(paths?: string[]): ClassProblem[];
