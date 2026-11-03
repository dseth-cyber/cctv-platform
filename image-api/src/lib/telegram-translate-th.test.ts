import { describe, it, expect } from 'vitest';
import { translateCameraAlertToThai } from './telegram-translate-th.js';

describe('translateCameraAlertToThai', () => {
  it('translates recording storage alerts with their numbers', async () => {
    const r = await translateCameraAlertToThai(
      'Emergency FIFO Eviction Triggered',
      'Recording disk usage is critical at 95.0% (Threshold: 92%). Deleting the oldest non-legal-hold recordings (quarantined first) until usage < 85%.',
    );
    expect(r.title).toBe('ดิสก์บันทึกวิกฤต — เริ่มลบไฟล์เก่าสุด');
    expect(r.message).toContain('95.0%');
    expect(r.message).toContain('85%');
  });

  it('translates the real-time stream-drop and recovery messages', async () => {
    const off = await translateCameraAlertToThai('Camera offline: cam-1', 'Camera "cam-1" stream disconnected instantly (< 3s detection). Stream: sim/ch1.');
    expect(off).toEqual({ title: 'กล้องออฟไลน์: cam-1', message: 'กล้อง "cam-1" สตรีมขาดทันที (ตรวจพบภายใน 3 วินาที) สตรีม: sim/ch1' });
    const on = await translateCameraAlertToThai('Camera online: cam-1', 'Camera "cam-1" is back online via real-time webhook. Downtime: 1m 47s');
    expect(on.message).toBe('กล้อง "cam-1" กลับมาออนไลน์แล้ว ระยะเวลาที่ดาวน์: 1 นาที 47 วินาที');
  });

  it('keeps unknown alerts untouched', async () => {
    expect(await translateCameraAlertToThai('Something new', 'raw text')).toEqual({ title: 'Something new', message: 'raw text' });
  });
});
