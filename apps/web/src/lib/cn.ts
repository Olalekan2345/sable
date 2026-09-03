/**
 * Minimal class-name joiner.
 *
 * Sable's component surface is small and every component owns its own variants, so a
 * conflict-resolving merge utility would be weight without benefit. Falsy values are
 * dropped so conditional classes read cleanly at the call site.
 */
export type ClassValue = string | number | null | undefined | false | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value && value !== 0) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    out.push(String(value));
  };

  for (const value of values) walk(value);
  return out.join(" ");
}
