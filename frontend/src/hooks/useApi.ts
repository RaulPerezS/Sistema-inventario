import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, cleanParams, errorMessage } from '@/lib/api';
import type { Paginated } from '@/lib/types';

/** Lista paginada de un recurso REST. */
export function useList<T>(resource: string, params: Record<string, unknown> = {}, enabled = true) {
  return useQuery({
    queryKey: [resource, params],
    queryFn: async () => (await api.get<Paginated<T>>(resource, { params: cleanParams(params) })).data,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useGet<T>(url: string | null, params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: [url, params],
    queryFn: async () => (await api.get<T>(url!, { params: cleanParams(params) })).data,
    enabled: !!url,
  });
}

/** Opciones para selects (hasta 100 registros activos). */
export function useOptions<T extends { id: string }>(resource: string, params: Record<string, unknown> = {}) {
  return useList<T>(resource, { limit: 100, ...params });
}

/** Mutación genérica con toasts e invalidación de caché. */
export function useApiMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  opts: { success?: string; invalidate?: string[]; onSuccess?: (data: TResult) => void } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      if (opts.success) toast.success(opts.success);
      const prefixes = opts.invalidate ?? [];
      if (prefixes.length) {
        queryClient.invalidateQueries({
          predicate: (q) => typeof q.queryKey[0] === 'string' && prefixes.some((p) => (q.queryKey[0] as string).startsWith(p)),
        });
      }
      opts.onSuccess?.(data);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
