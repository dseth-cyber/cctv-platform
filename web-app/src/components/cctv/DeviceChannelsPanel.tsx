import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts/ToastContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { Button } from '@/components/ui';
import { WhepPlayer } from '@/components/cctv/WhepPlayer';
import { ChannelChecklist } from '@/components/cctv/ChannelChecklist';
import { Radio } from 'lucide-react';

const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The channels of one recorder: which are in use, and how those are doing. A channel switched off is not
 * watched and raises no alert, which keeps "no camera there" apart from "the camera is broken".
 */
export function DeviceChannelsPanel({ deviceId, canEdit }: { deviceId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: device } = useQuery<any>({
    queryKey: ['cctv-device', deviceId],
    queryFn: () => imageServiceApi.getDevice(deviceId),
    refetchInterval: 15_000,
  });
  const cameras: any[] = device?.cameras ?? [];
  const saved = cameras.filter((c) => c.enabled && c.channelNumber).map((c) => c.channelNumber as number).sort((a, b) => a - b);
  const savedKey = saved.join(',');
  const [enabled, setEnabled] = useState<number[]>(saved);
  useEffect(() => setEnabled(saved), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const { data: stream } = useQuery<any>({
    queryKey: ['camera-stream', preview?.id],
    queryFn: () => imageServiceApi.getCameraStream(preview!.id, { profile: 'sub' }),
    enabled: !!preview,
  });

  const save = useMutation({
    mutationFn: () => imageServiceApi.setDeviceChannels(deviceId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cctv-device', deviceId] });
      queryClient.invalidateQueries({ queryKey: ['cctv-devices'] });
      queryClient.invalidateQueries({ queryKey: ['cctv-cameras'] });
      toast.success(t('ui.deviceManagement.channelsSaved'));
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || t('common.error')),
  });

  if (!device) return null;

  const statusOf = (channel: number) => {
    const cam = cameras.find((c) => c.channelNumber === channel);
    if (!cam || !cam.enabled) return { text: t('ui.deviceManagement.channelOff'), dotClass: 'bg-slate-700' };
    if (cam.operationalStatus === 'online') return { text: t('ui.deviceManagement.channelOnline'), dotClass: 'bg-emerald-400' };
    if (cam.operationalStatus === 'offline') return { text: t('ui.deviceManagement.channelOffline'), dotClass: 'bg-rose-500' };
    return { text: t('ui.deviceManagement.channelChecking'), dotClass: 'bg-amber-400' };
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">{t('ui.deviceManagement.channelsHint')}</p>
      <ChannelChecklist total={device.totalChannels} enabled={enabled} onChange={setEnabled} statusOf={statusOf} />
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Button onClick={() => save.mutate()} disabled={save.isPending || sameList(enabled, saved)} className="text-xs py-1 px-3 bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40">
            {t('ui.deviceManagement.channelsSave')}
          </Button>
        )}
        {cameras.filter((c) => c.enabled).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setPreview(preview?.id === c.id ? null : { id: c.id, name: c.name })}
            className={`px-2 py-1 rounded-lg border text-[11px] transition ${preview?.id === c.id ? 'border-cyan-500 text-cyan-300' : 'border-slate-800 text-slate-300 hover:border-slate-600'}`}
            title={c.name}
          >
            <Radio className="w-3 h-3 inline mr-1" />
            {t('ui.deviceManagement.channelN', { n: c.channelNumber })}
          </button>
        ))}
      </div>
      {preview && stream?.webrtcWhepUrl && (
        <div className="p-3 bg-slate-900 border border-cyan-800/50 rounded-xl">
          <WhepPlayer key={stream.webrtcWhepUrl} streamUrl={stream.webrtcWhepUrl} cameraName={preview.name} streamProfile="sub" className="w-full max-w-2xl mx-auto aspect-video" />
        </div>
      )}
    </div>
  );
}
