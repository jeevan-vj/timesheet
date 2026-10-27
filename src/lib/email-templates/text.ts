const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);
}

export function singleLine(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}
