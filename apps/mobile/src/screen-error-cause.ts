export function screenErrorCause(error: { name?: string; message?: string } | null | undefined): string {
  const name = typeof error?.name === "string" && error.name.trim() ? error.name.trim() : "Error";
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return message ? `${name}: ${message}` : name;
}
