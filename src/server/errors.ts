export type AppErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'unauthenticated'
  | 'read_only'
  | 'unavailable';

/** Errors that are safe to show to the person who triggered them. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: AppErrorCode,
    public readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const forbidden = (message = 'You do not have permission to do that.') => new AppError(message, 'forbidden');
/** Used for anything the person may not see, so its existence is not revealed. */
export const notFound = (message = 'We could not find that.') => new AppError(message, 'not_found');
export const invalid = (message: string, fieldErrors?: Record<string, string>) =>
  new AppError(message, 'validation', fieldErrors);
export const conflict = (message: string) => new AppError(message, 'conflict');
export const readOnly = () =>
  new AppError('You are viewing as someone else, so changes are switched off.', 'read_only');
