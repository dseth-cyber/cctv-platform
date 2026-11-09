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

  it('keeps a live link line, in Thai, after the translated message', async () => {
    const off = await translateCameraAlertToThai('Camera offline: MD - Ch 4', 'Camera "MD - Ch 4" is offline. The recorder reports no video signal on this channel. Status: active. Last poll: never\nLive: http://192.168.30.77:8090/cctv/live-grid?focus=abc');
    expect(off.message.split('\n')).toEqual([
      expect.stringMatching(/^กล้อง "MD - Ch 4" ออฟไลน์ \(เครื่องบันทึกแจ้งว่าช่องนี้ไม่มีสัญญาณภาพ\) สถานะ: /),
      'ดูภาพสด: http://192.168.30.77:8090/cctv/live-grid?focus=abc',
    ]);
    const on = await translateCameraAlertToThai('Camera online: cam-1', 'Camera "cam-1" is back online. Downtime: 2m 5s\nLive: http://h/cctv/live-grid?focus=x');
    expect(on.message).toBe('กล้อง "cam-1" กลับมาออนไลน์แล้ว ระยะเวลาที่ดาวน์: 2 นาที 5 วินาที\nดูภาพสด: http://h/cctv/live-grid?focus=x');
  });

  it('translates the webhook stream-lost message (it went out in English)', async () => {
    const r = await translateCameraAlertToThai('Camera offline: cam-1', 'Camera "cam-1" stream disconnected. Stream: dvr_x_ch1.');
    expect(r.message).toBe('กล้อง "cam-1" สตรีมขาด สตรีม: dvr_x_ch1');
  });

  it('keeps unknown alerts untouched', async () => {
    expect(await translateCameraAlertToThai('Something new', 'raw text')).toEqual({ title: 'Something new', message: 'raw text' });
  });
});
