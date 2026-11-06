import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { imageServiceApi } from '@/services/imageServiceApi';

const KEY = ['camera-favorites'];

/** The viewer's starred cameras. One place, so a star set in any view shows in all of them at once. */
export function useCameraFavorites() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<string[]>({
    queryKey: KEY,
    queryFn: () => imageServiceApi.getCameraFavorites(),
  });
  const favorites = useMemo(() => new Set(data ?? []), [data]);
  const toggleFavorite = useCallback(
    (id: string) => {
      const isStarred = (queryClient.getQueryData<string[]>(KEY) ?? []).includes(id);
      queryClient.setQueryData<string[]>(KEY, (prev = []) => (isStarred ? prev.filter((f) => f !== id) : [...prev, id]));
      (isStarred ? imageServiceApi.removeCameraFavorite(id) : imageServiceApi.addCameraFavorite(id)).catch(() =>
        queryClient.invalidateQueries({ queryKey: KEY }),
      );
    },
    [queryClient],
  );
  return { favorites, isLoading, toggleFavorite };
}
