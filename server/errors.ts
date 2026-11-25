// Typed error taxonomy. Route handlers throw these; the router maps them to HTTP responses.
export class HttpError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}
export class ValidationError extends HttpError {
  constructor(message: string) { super(400, message, 'validation_error'); }
}
export class AuthenticationError extends HttpError {
  constructor(message = 'Please sign in.') { super(401, message, 'unauthenticated'); }
}
export class AuthorizationError extends HttpError {
  constructor(message = 'You do not have permission to do that.') { super(403, message, 'forbidden'); }
}
export class NotFoundError extends HttpError {
  constructor(message = 'Not found.') { super(404, message, 'not_found'); }
}
export class ConflictError extends HttpError {
  constructor(message: string) { super(409, message, 'conflict'); }
}
export class RateLimitError extends HttpError {
  constructor(message: string) { super(429, message, 'rate_limited'); }
}
export class ExternalServiceError extends HttpError {
  constructor(message: string) { super(502, message, 'external_service_error'); }
}
