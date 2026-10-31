import { useQuery } from '@tanstack/react-query';
import { imageServiceApi } from '@/services/imageServiceApi';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Server feature switches [R2.2]. `factoryModules` is false unless the API runs with
 * FACTORY_MODULES_ENABLED=true; factory pages, widgets and queries must stay off then,
 * because their endpoints are not registered.
 *
 * While the flag is still loading (or the call failed) factory features count as off,
 * so the UI never calls endpoints that may not exist.
 */
export function useFeatures() {
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({
    queryKey: ['server-features'],
    queryFn: () => imageServiceApi.getFeatures(),
    enabled: isAuthenticated,
    staleTime: Infinity,
    retry: false,
  });
  return { factoryModules: data?.factoryModules === true };
}
