import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { imageServiceApi } from '@/services/imageServiceApi';
import { catalogFieldsFor } from '@/config/requiredFieldsCatalog';

/**
 * Fetches the admin-configured required-fields map (cached) and exposes helpers
 * for a single entity. Fields flagged `alwaysRequired` in the catalog are always
 * treated as required regardless of the saved config.
 *
 * Currently WIRED into: the Camera create/edit form and the incident
 * status-change dialog (both in ImageServiceCameras.tsx). Other entities save
 * config + expose the catalog, but their forms are not yet enforced.
 *
 * Requires system-config:read on the backend, which a role focused on some
 * other entity (e.g. just Cameras) has no obvious reason to also grant — fail
 * silently and fall back to only the always-required fields rather than
 * surface a confusing "forbidden" toast while someone's just filling out a form.
 */
export function useRequiredFields(entity: string) {
  const { data, isLoading } = useQuery({
    queryKey: ['required-fields'],
    queryFn: () => imageServiceApi.getRequiredFields({ silent403: true }),
    staleTime: 1000 * 60 * 5,
  });

  const required = useMemo(() => {
    const configured = (data?.[entity] ?? []) as string[];
    const always = catalogFieldsFor(entity).filter(f => f.alwaysRequired).map(f => f.key);
    return new Set<string>([...configured, ...always]);
  }, [data, entity]);

  const isRequired = (field: string) => required.has(field);

  return { required, isRequired, isLoading };
}
