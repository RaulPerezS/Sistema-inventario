import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Renovación automática del token (una sola petición de refresh para llamadas concurrentes)
let refreshing: Promise<string | null> | null = null;
let onSessionExpired: () => void = () => undefined;
export const setSessionExpiredHandler = (fn: () => void) => {
  onSessionExpired = fn;
};

export async function refreshSession(): Promise<string | null> {
  refreshing ??= axios
    .post('/api/v1/auth/refresh', {}, { withCredentials: true })
    .then((r) => {
      setAccessToken(r.data.accessToken);
      return r.data as { accessToken: string };
    })
    .then((d) => d.accessToken)
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
  if (error.response?.status === 401 && original && !original._retry && !original.url?.startsWith('/auth/')) {
    original._retry = true;
    const token = await refreshSession();
    if (token) return api(original);
    onSessionExpired();
  }
  throw error;
});

interface ApiErrorBody {
  error?: { code: string; message: string; details?: unknown };
}

/** Mensaje legible a partir de un error de la API. */
export function errorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const body = err.response?.data as ApiErrorBody | undefined;
    if (body?.error) {
      const details = body.error.details;
      if (Array.isArray(details) && details.length && typeof details[0] === 'object' && details[0] && 'message' in details[0]) {
        return `${body.error.message}: ${(details as { path: string; message: string }[]).map((d) => `${d.path ? d.path + ': ' : ''}${d.message}`).join('; ')}`;
      }
      return body.error.message;
    }
    if (!err.response) return 'No se pudo conectar con el servidor';
  }
  return err instanceof Error ? err.message : 'Error inesperado';
}

/** Descarga un archivo (CSV) respetando la autenticación. */
export async function download(url: string, params?: Record<string, unknown>) {
  const res = await api.get(url, { params, responseType: 'blob' });
  const disposition = String(res.headers['content-disposition'] ?? '');
  const filename = /filename="(.+)"/.exec(disposition)?.[1] ?? 'export.csv';
  const href = URL.createObjectURL(res.data as Blob);
  const a = Object.assign(document.createElement('a'), { href, download: filename });
  a.click();
  URL.revokeObjectURL(href);
}

/** Elimina parámetros vacíos para no ensuciar la query-string. */
export function cleanParams<T extends Record<string, unknown>>(params: T): Partial<T> {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as Partial<T>;
}
