import { describe, expect, it } from 'vitest';
import { detectIntent, findCamera, findPage, periodOf } from './assistant-intent.js';
import { findHowTo } from './assistant-howto.js';

describe('assistant: what is asked', () => {
  it.each([
    ['สรุปสถานะวันนี้', 'summary'],
    ['กล้องไหนออฟไลน์บ้าง', 'offline_cameras'],
    ['which cameras are offline', 'offline_cameras'],
    ['เครื่องบันทึกมีปัญหาไหม', 'recorder_problems'],
    ['เครื่องไหนไม่บันทึก', 'not_recording'],
    ['เวลาเครื่องบันทึกตรงไหม', 'clock'],
    ['incident ที่ยังเปิด', 'incidents'],
    ['ใบงานค้าง', 'work_orders'],
    ['ดูสด MD ช่อง 4', 'open_live'],
    ['ไปหน้ารายงาน', 'navigate'],
    ['ตั้ง NTP ยังไง', 'howto'],
    ['ภาพสดไม่ขึ้นทุกกล้องแก้ยังไง', 'howto'],
    ['ความพร้อมใช้งาน 30 วัน', 'availability'],
    ['กล้องที่หลุดบ่อย 7 วัน', 'flapping'],
    ['สถิติ incident เดือนนี้', 'incident_stats'],
    ['เก็บย้อนหลังได้กี่วัน', 'retention'],
    ['แจ้งเตือนวันนี้', 'alert_stats'],
    ['สถานะ server', 'server'],
    ['ใครกำลังดูภาพสด', 'live_now'],
    ['สวัสดี', 'help'],
  ])('%s -> %s', (q, intent) => expect(detectIntent(q)).toBe(intent));

  it('reads the period of a statistics question', () => {
    expect(periodOf('ความพร้อม 30 วัน').key).toBe('30d');
    expect(periodOf('เดือนนี้').key).toBe('30d');
    expect(periodOf('วันนี้').key).toBe('1d');
    expect(periodOf('หลุดบ่อย').key).toBe('7d');
  });

  it('finds a camera by recorder + channel, preferring the longer recorder name', () => {
    const cams = [
      { id: 'a', name: 'MD - Ch 4', channelNumber: 4, deviceName: 'MD' },
      { id: 'b', name: 'MD 2 - Ch 4', channelNumber: 4, deviceName: 'MD 2' },
      { id: 'c', name: 'DVR แผนกสโตร์ - Ch 1', channelNumber: 1, deviceName: 'DVR แผนกสโตร์' },
    ];
    expect(findCamera('ดูสด md ช่อง 4', cams)?.id).toBe('a');
    expect(findCamera('ดูสด MD 2 ch4', cams)?.id).toBe('b');
    expect(findCamera('เปิดดู DVR แผนกสโตร์ - Ch 1', cams)?.id).toBe('c');
    expect(findCamera('ดูสด MD ช่อง 9', cams)).toBeNull();
  });

  it('finds the page asked for', () => {
    expect(findPage('ไปหน้าห้องภาพสด')?.path).toBe('/cctv/live-grid');
    expect(findPage('เปิดหน้าใบงาน')?.path).toBe('/cctv/work-orders');
  });

  it('finds how-to topics, best first', () => {
    expect(findHowTo('ภาพสดไม่ขึ้นทุกกล้อง')[0].id).toBe('all_live_down');
    expect(findHowTo('ตั้ง ntp ยังไง')[0].id).toBe('clock_ntp');
    expect(findHowTo('hd ช้า ทำไม')[0].id).toBe('hd_slow');
  });
});
