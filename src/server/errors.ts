/**
 * Errors whose `code` is safe to show to customers. Codes map to translated,
 * human-friendly messages under `errors.*` in the message catalogs.
 * Technical detail stays in `cause` and logs.
 */
export class UserFacingError extends Error {
  constructor(
    public code: string,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "UserFacingError";
  }
}

export class NotFoundError extends UserFacingError {
  constructor(entity = "item") {
    super(`${entity}_not_found`);
    this.name = "NotFoundError";
  }
}
