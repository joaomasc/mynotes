import { twMerge } from 'tailwind-merge';

/**
 * Joins class names, skipping falsy values. Conflicting Tailwind utilities are
 * resolved in favour of the last one, so a `className` prop can override a
 * component's defaults (e.g. `hidden` over `inline-flex`).
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return twMerge(parts.filter(Boolean).join(' '));
}
