/**
 * Raised when the browser refuses a write because the origin's storage quota is
 * full. Lives in its own module so the Chat screen can `instanceof`-check it on
 * every platform, while only the web store ever throws it.
 */
export class StorageFullError extends Error {
  constructor() {
    super('Browser storage is full.');
    this.name = 'StorageFullError';
  }
}

/** Chrome/Safari/Firefox all signal a full quota differently. Cover all three. */
export function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  // Safari: QuotaExceededError. Firefox: NS_ERROR_DOM_QUOTA_REACHED.
  // Chrome also sets DOMException.code 22 (or 1014 on older Firefox).
  const code = (e as { code?: number }).code;
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}
