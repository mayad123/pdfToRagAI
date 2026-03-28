/**
 * Minimal cleanup: collapse whitespace, fix common line-break hyphenation.
 */
export function cleanPageText(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/-\n\s*/g, "");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}
