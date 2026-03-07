export type Success<T> = { ok: true; value: T };
export type Failure<E> = { ok: false; error: E };
export type Result<T, E> = Success<T> | Failure<E>;
