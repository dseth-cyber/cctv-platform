import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, SearchableSelect } from '@/components/ui';
import { LocationFields } from '@/components/cctv/LocationFields';
import { useMasterdataOptions } from '@/hooks/useMasterdataOptions';
import { imageServiceApi } from '@/services/imageServiceApi';
import { useToast } from '@/contexts/ToastContext';

const KEEP = '__keep__';
const CLEAR = '__clear__';

/** Changes only what is chosen here, on every selected camera. Everything left at "no change" stays as it is. */
export function BulkCameraEditModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { options: types } = useMasterdataOptions('camera_type');
  const { options: brands } = useMasterdataOptions('camera_brand');
  const { options: alertLevels } = useMasterdataOptions('alert_level');
  const [cameraType, setCameraType] = useState(KEEP);
  const [cameraBrand, setCameraBrand] = useState(KEEP);
  const [cameraModel, setCameraModel] = useState('');
  const [alertLevel, setAlertLevel] = useState(KEEP);
  const [enabled, setEnabled] = useState(KEEP);
  const [placeMode, setPlaceMode] = useState<'keep' | 'device' | 'set'>('keep');
  const [place, setPlace] = useState({ siteId: '', zoneId: '' });
  const [failed, setFailed] = useState<Array<{ name: string; message: string }>>([]);
  const [saving, setSaving] = useState(false);

  const keepOption = { value: KEEP, label: t('ui.bulkEdit.noChange') };
  const clearOption = { value: CLEAR, label: t('ui.bulkEdit.clear') };

  const changes: Record<string, unknown> = {};
  if (cameraType !== KEEP) changes.cameraType = cameraType === CLEAR ? null : cameraType;
  if (cameraBrand !== KEEP) changes.cameraBrand = cameraBrand === CLEAR ? null : cameraBrand;
  if (cameraModel.trim()) changes.cameraModel = cameraModel.trim();
  if (alertLevel !== KEEP) changes.alertLevel = alertLevel === CLEAR ? null : alertLevel;
  if (enabled !== KEEP) changes.enabled = enabled === 'on';
  if (placeMode === 'device') changes.locationFromDevice = true;
  if (placeMode === 'set') Object.assign(changes, { locationFromDevice: false, siteId: place.siteId || null, zoneId: place.zoneId || null });
  const nothingToDo = Object.keys(changes).length === 0;

  const handleApply = async () => {
    setSaving(true);
    try {
      const res = await imageServiceApi.bulkUpdateCameras(ids, changes);
      if (res.failed.length > 0) {
        setFailed(res.failed);
        toast.warning(t('ui.bulkEdit.partly', { done: res.updated, failed: res.failed.length }));
      } else {
        toast.success(t('ui.bulkEdit.done', { count: res.updated }));
        onDone();
      }
    } catch (err: any) {
      if (!err?._handled) toast.error(err?.response?.data?.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const label = 'block text-xs font-medium text-slate-300 mb-1';
  return (
    <Modal isOpen onClose={onClose} title={t('ui.bulkEdit.title', { count: ids.length })}>
      <div className="space-y-4 text-slate-200" data-bulk-edit>
        <p className="text-xs text-slate-400">{t('ui.bulkEdit.hint')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>{t('imageService.cameras.cameraType')}</label>
            <SearchableSelect value={cameraType} onChange={setCameraType} showSearch={false} options={[keepOption, clearOption, ...types.map((o) => ({ value: o.value, label: o.label }))]} />
          </div>
          <div>
            <label className={label}>{t('imageService.cameras.cameraBrand')}</label>
            <SearchableSelect value={cameraBrand} onChange={setCameraBrand} options={[keepOption, clearOption, ...brands.map((o) => ({ value: o.value, label: o.label }))]} />
          </div>
          <div data-bulk-alert-level>
            <label className={label}>{t('imageService.cameras.alertLevel')}</label>
            <SearchableSelect value={alertLevel} onChange={setAlertLevel} showSearch={false} options={[keepOption, { value: CLEAR, label: t('ui.bulkEdit.alertLevelFollow') }, ...alertLevels.map((o) => ({ value: o.value, label: o.label }))]} />
          </div>
          <div>
            <label className={label}>{t('imageService.cameras.cameraModel')}</label>
            <input
              value={cameraModel}
              maxLength={64}
              onChange={(e) => setCameraModel(e.target.value)}
              placeholder={t('ui.bulkEdit.noChange')}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div>
            <label className={label}>{t('imageService.cameras.enabledField')}</label>
            <SearchableSelect value={enabled} onChange={setEnabled} showSearch={false} options={[keepOption, { value: 'on', label: t('ui.bulkEdit.on') }, { value: 'off', label: t('ui.bulkEdit.off') }]} />
          </div>
        </div>
        <div className="space-y-2">
          <label className={label}>{t('ui.location.site')} / {t('ui.location.zone')}</label>
          <SearchableSelect
            value={placeMode}
            onChange={(v) => setPlaceMode(v as 'keep' | 'device' | 'set')}
            showSearch={false}
            options={[keepOption && { value: 'keep', label: t('ui.bulkEdit.noChange') }, { value: 'device', label: t('ui.location.fromDevice') }, { value: 'set', label: t('ui.bulkEdit.setPlace') }]}
          />
          {placeMode === 'set' && <LocationFields siteId={place.siteId} zoneId={place.zoneId} labelClass={label} onChange={setPlace} />}
        </div>
        {enabled === 'off' && <p className="text-[11px] text-amber-300">{t('imageService.cameras.enabledHint')}</p>}
        {failed.length > 0 && (
          <ul className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/40 text-xs text-rose-200 space-y-1 max-h-32 overflow-y-auto">
            {failed.map((f, i) => <li key={i}><b>{f.name}</b>: {f.message}</li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
          <Button variant="secondary" onClick={failed.length > 0 ? onDone : onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleApply} disabled={nothingToDo || saving}>{t('ui.bulkEdit.apply', { count: ids.length })}</Button>
        </div>
      </div>
    </Modal>
  );
}
