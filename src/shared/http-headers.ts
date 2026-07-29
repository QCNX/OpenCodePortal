/** Join HTTP header values (Node may emit string or string[]). */
export function headerToString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(',') : (value ?? '');
}
