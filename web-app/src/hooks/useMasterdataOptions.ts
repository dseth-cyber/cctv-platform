import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { imageServiceApi } from '@/services/imageServiceApi';

export type MasterdataOptionType = 'camera_type' | 'camera_brand' | 'device_type' | 'device_brand' | 'device_channel_count';

const NAME_FIELD: Record<string, string> = { th: 'nameTh', en: 'nameEn', cn: 'nameCn', mm: 'nameMm', jp: 'nameJp' };

export function masterdataLabel(item: any, language: string): string {
  return item?.[NAME_FIELD[language?.slice(0, 2)] ?? 'nameEn'] || item?.nameEn || item?.nameTh || item?.code || '';
}

/** A list people choose from, in the signed-in user's language, as managed on the master data page. */
export function useMasterdataOptions(type: MasterdataOptionType) {
  const { i18n } = useTranslation();
  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ['masterdata-options', type],
    queryFn: () => imageServiceApi.getMasterdataOptions(type),
    staleTime: 60_000,
  });
  const options = useMemo(
    () => data.map((item) => ({ value: item.code as string, label: masterdataLabel(item, i18n.language), isDefault: !!item.isDefault })),
    [data, i18n.language],
  );
  return { options, isLoading };
}
