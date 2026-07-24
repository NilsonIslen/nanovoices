export const MESSAGE_MAX_LENGTH = 1000;

export function sanitizeMessage(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX_LENGTH);
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
