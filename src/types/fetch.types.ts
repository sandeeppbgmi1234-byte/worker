export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface FetchResult<T = any> {
  data: T;
  status: number;
  statusText: string;
}

export interface InstagramFetchOptions extends Omit<RequestInit, "body"> {
  body?: any;
  timeoutMs?: number;
  retries?: number;
  webhookUserId?: string;
}
