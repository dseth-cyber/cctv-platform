import { useQuery } from '@tanstack/react-query';
import { imageServiceApi } from '@/services/imageServiceApi';

/**
 * The enabled, non-deleted cameras with their live status — one query shared by Live Grid, Map
 * and the Dashboard so every page shows the same online/offline counts. Status changes come from
 * MediaMTX hooks and the health monitor, so the list is refreshed every 10 s.
 */
export function useCctvCameras() {
  return useQuery<any[]>({
    queryKey: ['cctv-cameras', 'enabled'],
    queryFn: () => imageServiceApi.getCameras({ enabled: true }),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}
