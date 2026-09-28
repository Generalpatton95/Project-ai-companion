import { NotFoundError } from '../utils/errors.js';

/** Catches requests that no route handled (R2.3). */
export function notFound(req, res, next) {
  next(new NotFoundError('Route not found'));
}
