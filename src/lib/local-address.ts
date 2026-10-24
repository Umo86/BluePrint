/** Whether a web address points at this computer (used to keep test-only helpers off live sites). */
export function isLocalAddress(url: string | null | undefined) {
  if (!url) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
