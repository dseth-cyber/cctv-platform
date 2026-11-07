import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronRight } from 'lucide-react';
import { useMasterdataOptions, type MasterdataOptionType } from '@/hooks/useMasterdataOptions';
import { buildInventorySlices, type InventorySlice } from '@/lib/inventorySlices';

// Validated for this dark card surface. A colour follows a list entry, so it never changes with the counts.
const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
const NEUTRAL_COLORS = { none: '#64748b', other: '#94a3b8' };
const SURFACE = '#1b1838';

const colorOf = (slice: InventorySlice) => (slice.kind === 'value' ? SERIES_COLORS[slice.colorSlot] ?? NEUTRAL_COLORS.other : NEUTRAL_COLORS[slice.kind]);

type ChartForm = 'donut' | 'pie' | 'bars' | 'columns';

function ChartTooltip({ active, payload }: any) {
  const slice: InventorySlice | undefined = payload?.[0]?.payload;
  if (!active || !slice) return null;
  return (
    <div className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs shadow-xl">
      <div className="text-slate-300">{slice.label}</div>
      <div className="text-white font-semibold">{slice.count.toLocaleString()} ({slice.percent}%)</div>
    </div>
  );
}

// ResponsiveContainer hands its size to its direct child, which has to pass it on to the chart.
function Marks({ form, slices, onPick, width, height }: { form: ChartForm; slices: InventorySlice[]; onPick: (slice: InventorySlice) => void; width?: number; height?: number }) {
  const cells = slices.map((slice) => <Cell key={slice.key} fill={colorOf(slice)} cursor="pointer" />);
  if (form === 'donut' || form === 'pie') {
    return (
      <PieChart width={width} height={height}>
        <Pie data={slices} dataKey="count" nameKey="label" innerRadius={form === 'donut' ? '58%' : 0} outerRadius="92%"
          stroke={SURFACE} strokeWidth={slices.length > 1 ? 2 : 0} isAnimationActive={false} onClick={(entry: any) => onPick(entry.payload ?? entry)}>
          {cells}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
      </PieChart>
    );
  }
  const horizontal = form === 'bars';
  return (
    <BarChart width={width} height={height} data={slices} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
      <CartesianGrid stroke="#ffffff14" vertical={horizontal} horizontal={!horizontal} />
      {horizontal ? (
        <>
          <XAxis type="number" allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="short" width={84} tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} />
        </>
      ) : (
        <>
          <XAxis dataKey="short" interval={0} tick={{ fill: '#cbd5e1', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} width={32} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
        </>
      )}
      <Tooltip content={<ChartTooltip />} cursor={{ fill: '#ffffff0d' }} />
      <Bar dataKey="count" maxBarSize={28} minPointSize={4} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} isAnimationActive={false}
        onClick={(entry: any) => onPick(entry.payload ?? entry)}>
        {cells}
      </Bar>
    </BarChart>
  );
}

function InventoryCard({ id, title, form, slices, listPath, onPick }: {
  id: string;
  title: string;
  form: ChartForm;
  slices: InventorySlice[];
  listPath: string;
  onPick: (slice: InventorySlice) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <section data-inventory-chart={id} className="bg-slate-900/60 backdrop-blur-md p-4 rounded-xl border border-white/10 hover:border-cyan-500/40 transition flex flex-col">
      <button type="button" onClick={() => navigate(listPath)} title={t('ui.cctvDashboard.openList')} className="flex items-center justify-between gap-2 text-left text-sm font-semibold text-slate-200 hover:text-cyan-300 mb-2">
        <span>{title}</span>
        <ChevronRight size={15} className="text-slate-500 shrink-0" />
      </button>
      {slices.length === 0 ? (
        <p className="flex-1 flex items-center justify-center min-h-40 text-xs text-slate-500">{t('ui.cctvDashboard.noInventoryData')}</p>
      ) : (
        <>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <Marks form={form} slices={slices} onPick={onPick} />
            </ResponsiveContainer>
          </div>
          {/* Also the keyboard way in and the table view: every value is written out, not only drawn. */}
          <ul className="mt-2 space-y-0.5">
            {slices.map((slice) => (
              <li key={slice.key}>
                <button type="button" data-inventory-item={slice.key} onClick={() => onPick(slice)} title={slice.label}
                  className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-left text-xs hover:bg-white/5">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorOf(slice) }} />
                  <span className="flex-1 truncate text-slate-300">{slice.label}</span>
                  <span className="text-white font-semibold tabular-nums">{slice.count.toLocaleString()}</span>
                  <span className="w-9 text-right text-slate-500 tabular-nums">{slice.percent}%</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function useSlices(values: Array<string | null | undefined>, listType: MasterdataOptionType) {
  const { t } = useTranslation();
  const { options } = useMasterdataOptions(listType);
  return useMemo(
    () => buildInventorySlices(values, options, { none: t('ui.cctvDashboard.notSpecified'), other: t('ui.cctvDashboard.otherItems') }),
    [values, options, t],
  );
}

/** What is installed, by type and brand. Pressing a value opens the list filtered to it. */
export function InventoryCharts({ devices, cameras }: { devices: any[]; cameras: any[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const deviceTypes = useMemo(() => devices.map((d) => d.deviceType), [devices]);
  const deviceBrands = useMemo(() => devices.map((d) => d.brand), [devices]);
  const cameraTypes = useMemo(() => cameras.map((c) => c.cameraType), [cameras]);
  const cameraBrands = useMemo(() => cameras.map((c) => c.cameraBrand), [cameras]);
  const deviceTypeSlices = useSlices(deviceTypes, 'device_type');
  const deviceBrandSlices = useSlices(deviceBrands, 'device_brand');
  const cameraTypeSlices = useSlices(cameraTypes, 'camera_type');
  const cameraBrandSlices = useSlices(cameraBrands, 'camera_brand');

  // "Other" is several values, so it opens the whole list.
  const openDevices = (param: string) => (slice: InventorySlice) =>
    navigate(slice.kind === 'other' ? '/cctv/devices' : `/cctv/devices?${param}=${encodeURIComponent(slice.key)}`);
  const openCameras = (param: string) => (slice: InventorySlice) =>
    navigate(slice.kind === 'other' ? '/cctv/cameras?on=1' : `/cctv/cameras?on=1&${param}=${encodeURIComponent(slice.key)}`);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
      <InventoryCard id="device-type" title={t('ui.cctvDashboard.byDeviceType')} form="donut" slices={deviceTypeSlices} listPath="/cctv/devices" onPick={openDevices('type')} />
      <InventoryCard id="device-brand" title={t('ui.cctvDashboard.byDeviceBrand')} form="pie" slices={deviceBrandSlices} listPath="/cctv/devices" onPick={openDevices('brand')} />
      <InventoryCard id="camera-type" title={t('ui.cctvDashboard.byCameraType')} form="bars" slices={cameraTypeSlices} listPath="/cctv/cameras?on=1" onPick={openCameras('type')} />
      <InventoryCard id="camera-brand" title={t('ui.cctvDashboard.byCameraBrand')} form="columns" slices={cameraBrandSlices} listPath="/cctv/cameras?on=1" onPick={openCameras('brand')} />
    </div>
  );
}
