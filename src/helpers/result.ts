import { Success, Failure, Result } from "../types";
export type { Success, Failure, Result };

export const ok = <T>(value: T): Success<T> => ({ ok: true, value });
export const fail = <E>(error: E): Failure<E> => ({ ok: false, error });
