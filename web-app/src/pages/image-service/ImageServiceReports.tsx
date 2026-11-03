import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/contexts/ThemeContext';
import { imageServiceApi } from '@/services/imageServiceApi';
import { formatDateTime } from '@/utils/dateUtils';
import { getLocalizedValue } from '@/utils/textUtils';
import { TableSkeleton, ExportButton, SearchableSelect } from '@/components/ui';
import {
  FileSpreadsheet, CheckSquare, Square, Search, Sliders, Camera, GripVertical,
  ChevronUp, ChevronDown, ChevronsUpDown
} from 'lucide-react';

const CAMERA_STATUS_LABELS: Record<string, string> = {
  active: 'Online / Active',
  inactive: 'Offline / Inactive',
  error: 'Error',
  maintenance: 'Maintenance',
};

const DEFAULT_COLUMNS = [
  { id: 'name', labelKey: 'imageService.reports.colName', defaultLabel: 'ชื่อกล้อง', visible: true },
  { id: 'status', labelKey: 'imageService.reports.colStatus', defaultLabel: 'สถานะ', visible: true },
  { id: 'ipAddress', labelKey: 'imageService.reports.colIp', defaultLabel: 'IP Address', visible: true },
  { id: 'cameraAgeDays', labelKey: 'imageService.reports.colAgeDays', defaultLabel: 'อายุกล้อง (วัน)', visible: true },
  { id: 'incidentCount', labelKey: 'imageService.reports.colIncidentsCount', defaultLabel: 'จำนวนที่พบปัญหา (ครั้ง)', visible: true },
  { id: 'topTechnician', labelKey: 'imageService.reports.colTopTech', defaultLabel: 'ช่างที่ดูแลหลัก', visible: true },
  { id: 'peakHour', labelKey: 'imageService.reports.colPeakHour', defaultLabel: 'ช่วงเวลาที่มีปัญหาบ่อยสุด', visible: true },
  { id: 'topReason', labelKey: 'imageService.reports.colTopReason', defaultLabel: 'สาเหตุหลักของปัญหา', visible: true },
  { id: 'lastPolledAt', labelKey: 'imageService.reports.colLastPolled', defaultLabel: 'สแกนล่าสุด', visible: true },
  { id: 'streamPath', labelKey: 'ui.imageServiceCameras.streamPath', defaultLabel: 'Stream path', visible: true },
  { id: 'description', labelKey: 'imageService.reports.colDesc', defaultLabel: 'คำอธิบาย', visible: false },
  { id: 'timezone', labelKey: 'imageService.reports.colTimezone', defaultLabel: 'โซนเวลา', visible: false },
  { id: 'createdAt', labelKey: 'imageService.reports.colCreated', defaultLabel: 'วันที่สร้าง', visible: false },
  { id: 'updatedAt', labelKey: 'imageService.reports.colUpdated', defaultLabel: 'วันที่แก้ไขล่าสุด', visible: false },
];

const STORAGE_KEY = 'image_service_reports_columns_v1';

export default function ImageServiceReports() {
  const { t, i18n } = useTranslation();
  const { themeConfig } = useTheme();

  // Columns Configuration
  const [columns, setColumns] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Sync saved configurations with default schema definitions to stay up to date
          const defaultIds = DEFAULT_COLUMNS.map(c => c.id);
          const validSaved = parsed.filter((c: any) => defaultIds.includes(c.id));
          const missing = DEFAULT_COLUMNS.filter(c => !validSaved.some((s: any) => s.id === c.id));
          
          // Re-attach labelKey and defaultLabel to prevent stale i18n configurations
          const merged = [...validSaved, ...missing].map(item => {
            const original = DEFAULT_COLUMNS.find(d => d.id === item.id);
            return {
              ...item,
              labelKey: original?.labelKey || item.labelKey,
              defaultLabel: original?.defaultLabel || item.defaultLabel,
            };
          });
          return merged;
        }
      }
    } catch (e) {
      console.error('Failed to parse saved report columns layout settings', e);
    }
    return DEFAULT_COLUMNS.map(c => ({ ...c }));
  });

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  
  // Search & Filter state
  const [q, setQ] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Pagination state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // Sort state
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  // Reset page to 1 when filters or sorting change
  useEffect(() => {
    setPage(1);
  }, [q, filterStatus, sortCol, sortDir]);

  // Ref for click outside detection
  const configRef = useRef<HTMLDivElement>(null);

  const statusOptions = useMemo(() => [
    { value: '', label: String(t('imageService.reports.filterAllStatus', 'แสดงทุกสถานะ')) },
    { value: 'active', label: String(t('imageService.cameras.active', 'Online')) },
    { value: 'maintenance', label: String(t('imageService.cameras.maintenance', 'Maintenance')) },
    { value: 'error', label: String(t('imageService.cameras.error', 'Error')) },
    { value: 'inactive', label: String(t('imageService.cameras.inactive', 'Offline')) }
  ], [t]);

  // Sync columns to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
    } catch (e) {
      console.error('Failed to save report columns layout settings', e);
    }
  }, [columns]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (configRef.current && !configRef.current.contains(event.target as Node)) {
        setIsConfigOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch cameras data
  const { data: cameras = [], isLoading } = useQuery({
    queryKey: ['reports-cameras'],
    queryFn: () => imageServiceApi.getCameras(),
    staleTime: 30000,
  });

  const camerasArr = useMemo(() => {
    return Array.isArray(cameras?.data) ? cameras.data : (Array.isArray(cameras) ? cameras : []);
  }, [cameras]);

  // HTML5 Drag and Drop Handlers
  const handleDrop = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;
    const updated = [...columns];
    const [draggedItem] = updated.splice(draggedIndex, 1);
    updated.splice(index, 0, draggedItem);
    setColumns(updated);
    setDraggedIndex(null);
  };

  // Toggle visibility of a column
  const toggleVisibility = (index: number) => {
    const updated = [...columns];
    updated[index].visible = !updated[index].visible;
    setColumns(updated);
  };

  // Select all or clear all visibility
  const setAllVisibility = (visible: boolean) => {
    setColumns(prev => prev.map(c => ({ ...c, visible })));
  };

  // Filtered cameras
  const filteredCameras = useMemo(() => {
    const filtered = camerasArr.filter((c: any) => {
      const matchesQ = q ? c.name.toLowerCase().includes(q.toLowerCase()) || c.ipAddress.includes(q) : true;
      const matchesStatus = filterStatus ? c.status === filterStatus : true;
      return matchesQ && matchesStatus;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a: any, b: any) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : dir;
      if (bv === null || bv === undefined) return -dir;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      if (Array.isArray(av) || Array.isArray(bv)) return String(av).localeCompare(String(bv)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [camerasArr, q, filterStatus, sortCol, sortDir]);

  const totalPages = useMemo(() => {
    return Math.ceil(filteredCameras.length / limit) || 1;
  }, [filteredCameras.length, limit]);

  const paginatedCameras = useMemo(() => {
    return filteredCameras.slice((page - 1) * limit, page * limit);
  }, [filteredCameras, page, limit]);

  // Format cell value based on column ID
  const formatValue = (cam: any, colId: string) => {
    const val = cam[colId];
    if (val === null || val === undefined) return '—';

    switch (colId) {
      case 'status':
        return t(`imageService.cameras.${val}`, CAMERA_STATUS_LABELS[val] || val);
      case 'topReason':
        return t(`imageService.incidents.reasons.${val}`, val);
      case 'convertToPng':
      case 'keepSmaller':
      case 'generateThumbnail':
        if (val === null) return t('imageService.cameras.inherit', 'Inherit');
        return val ? t('common.yes', 'Yes') : t('common.no', 'No');
      case 'acceptedExtensions':
        return Array.isArray(val) ? val.join(', ') : String(val);
      case 'lastPolledAt':
      case 'lastImageAt':
      case 'createdAt':
      case 'updatedAt':
        return formatDateTime(val, i18n.language);
      case 'totalImagesCount':
      case 'cameraAgeDays':
      case 'incidentCount':
        return Number(val).toLocaleString();
      case 'averageImagesPerDay':
        return Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      default:
        return String(val);
    }
  };

  // Build columns list for ExportButton
  const activeColumns = useMemo(() => {
    return columns
      .filter(c => c.visible)
      .map(c => ({
        key: c.id,
        label: String(t(c.labelKey, c.defaultLabel))
      }));
  }, [columns, t]);

  // Format data specifically for exports
  const exportData = useMemo(() => {
    return filteredCameras.map((cam: any) => {
      const row: Record<string, string> = {};
      columns.forEach(col => {
        row[col.id] = String(formatValue(cam, col.id));
      });
      return row;
    });
  }, [filteredCameras, columns, i18n.language, t]);

  return (
    <div className="pt-6 px-6 pb-2.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
        <div>
          <p className={`text-xs font-medium mb-0.5 uppercase tracking-widest ${themeConfig.text.secondary}`}>
            iSmart CCTV · {t('imageService.reports.title', 'รายงานข้อมูลกล้อง')}
          </p>
          <h2 className={`text-2xl font-bold ${themeConfig.text.primary}`}>{t('imageService.reports.title', 'รายงานข้อมูลกล้อง')}</h2>
          <p className={`text-sm ${themeConfig.text.secondary}`}>
            {t('imageService.reports.subtitle', 'เลือก จัดเรียงคอลัมน์ และส่งออกรายงานข้อมูลกล้องอย่างละเอียด')}
          </p>
        </div>
        <div className="flex items-center gap-2 relative">
          
          {/* Sliders Configuration Popover Toggle */}
          <div className="relative">
            <button
              onClick={() => setIsConfigOpen(!isConfigOpen)}
              className="p-2 rounded-lg text-xs font-semibold bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-600/30 transition-colors flex items-center justify-center"
              title={t('imageService.reports.tableConfig', 'ตั้งค่าตาราง')}
            >
              <Sliders size={16} />
            </button>

            {isConfigOpen && (
              <div
                ref={configRef}
                className="absolute right-0 top-full mt-2 w-72 z-50 rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md p-4 shadow-xl text-left"
              >
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/5">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    {t('imageService.reports.tableConfig', 'ตั้งค่าตาราง')}
                  </h4>
                  <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-gray-400">
                    {t('imageService.reports.dragToReorder', 'ลากเพื่อเรียงลำดับ')}
                  </span>
                </div>

                {/* Shortcuts */}
                <div className="flex justify-between text-[10px] mb-3 px-1">
                  <button onClick={() => setAllVisibility(true)} className="text-cyan-400 hover:underline">
                    {t('common.selectAll', 'เลือกทั้งหมด')}
                  </button>
                  <button onClick={() => setAllVisibility(false)} className="text-red-400 hover:underline">
                    {t('common.clearAll', 'ล้างทั้งหมด')}
                  </button>
                </div>

                {/* Draggable Columns List */}
                <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                  {columns.map((col, index) => (
                    <div
                      key={col.id}
                      draggable={true}
                      onDragStart={() => setDraggedIndex(index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(index)}
                      className={`flex items-center gap-2 p-1.5 rounded-lg border border-transparent hover:bg-white/5 hover:border-white/5 cursor-grab active:cursor-grabbing transition-all ${
                        draggedIndex === index ? 'opacity-40 border-cyan-500/30 bg-cyan-500/5' : ''
                      }`}
                    >
                      <GripVertical size={13} className="text-gray-500 flex-shrink-0" />
                      
                      <button
                        onClick={() => toggleVisibility(index)}
                        className={`flex-shrink-0 ${col.visible ? 'text-cyan-400' : 'text-gray-500'}`}
                      >
                        {col.visible ? <CheckSquare size={15} /> : <Square size={15} />}
                      </button>

                      <span className={`text-[11px] truncate ${col.visible ? 'text-slate-200' : 'text-gray-500'}`}>
                        {String(t(col.labelKey, col.defaultLabel))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Export Button */}
          <ExportButton
            filename={`camera_report_${new Date().toISOString().slice(0,10)}`}
            title={t('imageService.reports.title', 'รายงานข้อมูลกล้อง')}
            sections={[{
              title: t('imageService.reports.tableTitle', 'รายละเอียดข้อมูลกล้องทั้งหมด'),
              columns: activeColumns,
              data: exportData
            }]}
          />
        </div>
      </div>

      {/* Filters Card */}
      <div className={`${themeConfig.card} rounded-xl p-4 mb-4 border ${themeConfig.cardBorder}`}>
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('imageService.reports.searchPlaceholder', 'ค้นหากล้องด้วยชื่อหรือ IP...')}
              className={`w-full pl-9 pr-3 py-1.5 rounded-lg text-xs border ${themeConfig.inputBorder} ${themeConfig.inputBg} ${themeConfig.text.primary} focus:outline-none`}
            />
          </div>
          <div className="w-56 text-xs">
            <SearchableSelect
              value={filterStatus}
              onChange={setFilterStatus}
              placeholder={String(t('imageService.reports.filterAllStatus', 'แสดงทุกสถานะ'))}
              options={statusOptions}
            />
          </div>
          <div className={`text-xs ${themeConfig.text.secondary} ml-auto font-medium`}>
            {t('imageService.reports.activeColumns', 'เปิดอยู่ {{count}} คอลัมน์', { count: activeColumns.length })} · {t('imageService.reports.totalCameras', 'พบบันทึกทั้งหมด {{count}} กล้อง', { count: filteredCameras.length })}
          </div>
        </div>
      </div>

      {/* Table Card */}
      <div className={`${themeConfig.card} rounded-xl p-4 flex flex-col border ${themeConfig.cardBorder}`}>
        {/* Preview Table */}
        {isLoading ? (
          <TableSkeleton rows={8} cols={activeColumns.length || 4} />
        ) : filteredCameras.length === 0 ? (
          <div className="text-center py-20">
            <FileSpreadsheet size={40} className="mx-auto text-gray-600 mb-2 animate-bounce" />
            <p className={`text-sm ${themeConfig.text.secondary}`}>{t('imageService.reports.noData', 'ไม่พบข้อมูลกล้องตามเงื่อนไขที่เลือก')}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto overflow-y-auto relative border border-white/5 rounded-lg mb-2" style={{ height: 'calc(100vh - 395px)', maxHeight: 'calc(100vh - 395px)' }}>
              <table className="w-full text-xs text-left border-collapse">
                <thead className={`${themeConfig.tableHeader} sticky top-0 z-10 shadow-sm`}>
                  <tr className={`border-b ${themeConfig.cardBorder}`}>
                    {columns.filter(c => c.visible).map((col) => (
                      <th key={col.id} onClick={() => handleSort(col.id)}
                        className={`px-4 py-3 font-semibold ${themeConfig.text.secondary} border-r border-white/5 cursor-pointer select-none hover:text-cyan-300`}>
                        <div className="flex items-center gap-1">
                          {String(t(col.labelKey, col.defaultLabel))}
                          {sortCol === col.id
                            ? sortDir === 'asc' ? <ChevronUp size={11} className="text-cyan-400" /> : <ChevronDown size={11} className="text-cyan-400" />
                            : <ChevronsUpDown size={11} className="opacity-25" />}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={themeConfig.tableDivide}>
                  {paginatedCameras.map((cam: any) => (
                    <tr key={cam.id} className={`${themeConfig.tableRow} border-b border-white/5`}>
                      {columns.filter(c => c.visible).map((col) => {
                        const isName = col.id === 'name';
                        return (
                          <td key={col.id} className={`px-4 py-2.5 font-medium border-r border-white/5 ${isName ? themeConfig.text.primary : themeConfig.text.secondary}`}>
                            {isName ? (
                              <div className="flex items-center gap-1.5 font-semibold text-cyan-400">
                                <Camera size={13} />
                                {cam.name}
                              </div>
                            ) : (
                              String(formatValue(cam, col.id))
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className={`flex flex-wrap items-center justify-between gap-4 p-4 border-t ${themeConfig.cardBorder} bg-white/[0.01] -mx-4 -mb-4 mt-4`}>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${themeConfig.text.secondary}`}>{t('common.showPerPage', 'แสดงต่อหน้า')}:</span>
                <div className="w-20">
                  <SearchableSelect
                    value={String(limit)}
                    onChange={(v) => {
                      setLimit(Number(v))
                      setPage(1)
                    }}
                    showSearch={false}
                    options={[10, 20, 50, 100].map(v => ({
                      value: String(v),
                      label: String(v)
                    }))}
                  />
                </div>
                <span className={`text-xs ${themeConfig.text.secondary} ml-2`}>
                  {t('imageService.reports.totalCameras', 'พบบันทึกทั้งหมด {{count}} กล้อง', { count: filteredCameras.length })}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(1)}
                  className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
                >
                  « {t('common.first', 'หน้าแรก')}
                </button>
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
                >
                  ‹ {t('common.prev', 'ก่อนหน้า')}
                </button>
                
                <div className="flex items-center gap-1 mx-1">
                  <input
                    type="number"
                    value={page}
                    min={1}
                    max={totalPages}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      if (val >= 1 && val <= totalPages) setPage(val)
                    }}
                    className={`w-10 px-1 py-1 rounded text-xs text-center border ${themeConfig.inputBorder} ${themeConfig.card} ${themeConfig.text.primary} focus:outline-none focus:border-cyan-500 bg-transparent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                  />
                  <span className={`text-xs ${themeConfig.text.secondary}`}>/ {totalPages}</span>
                </div>

                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
                >
                  {t('common.next', 'ถัดไป')} ›
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(totalPages)}
                  className={`px-2.5 py-1.5 rounded text-xs border ${themeConfig.inputBorder} ${themeConfig.text.primary} disabled:opacity-30 disabled:hover:bg-transparent hover:bg-white/5 transition-colors`}
                >
                  {t('common.last', 'หน้าสุดท้าย')} »
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
