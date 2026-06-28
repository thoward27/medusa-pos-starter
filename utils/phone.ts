/**
 * Progressively formats a phone number as the US/NANP `(xxx) xxx-xxxx` mask.
 *
 * - Formats partial input as it's typed (e.g. `(555) 12`), so it works as a live
 *   input transform.
 * - Idempotent: re-formatting already-formatted output yields the same string,
 *   which keeps it safe to apply to both the stored value and the displayed value.
 * - The trailing character of any partial result is always a digit, so backspace
 *   always deletes a digit rather than sticking on a formatting character.
 * - Non-NANP / international numbers (more than 10 digits) are left as raw digits
 *   rather than forced into the US mask.
 */
export function formatPhoneNumber(input: string): string {
  const digits = input.replace(/\D/g, '');

  if (digits.length === 0) return '';
  if (digits.length > 10) return digits;

  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
