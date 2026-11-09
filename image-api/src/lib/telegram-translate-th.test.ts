import { describe, it, expect } from 'vitest';
import { translateCameraAlertToThai } from './telegram-translate-th.js';
import { clockRoundNotice, describeDrift } from '../modules/devices/device-health.service.js';

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

  it('translates recorder alerts: recording stopped, HDD, clock', async () => {
    const stopped = await translateCameraAlertToThai('Recording stopped: MD', 'MD: no recording in the last 30 minutes on channel 4, 6');
    expect(stopped).toEqual({ title: 'หยุดบันทึก: MD', message: 'MD: ไม่มีการบันทึกใน 30 นาทีล่าสุด ช่อง 4, 6' });
    const hdd = await translateCameraAlertToThai('HDD problem: MD 2', 'MD 2: disk_smart, disk_hot');
    expect(hdd).toEqual({ title: 'HDD มีปัญหา: MD 2', message: 'MD 2: SMART เตือน, HDD ร้อน (60°C ขึ้นไป)' });
    const clock = await translateCameraAlertToThai('Clock off: NVR EOE', `NVR EOE: clock is ${describeDrift(455)} (limit 60 s). Footage and clips carry the recorder's time; set NTP on the recorder.`);
    expect(clock).toEqual({ title: 'เวลาเครื่องไม่ตรง: NVR EOE', message: 'NVR EOE: เวลาเครื่องเร็วกว่า Server 7 นาที 35 วินาที (เกณฑ์ 60 วินาที) ภาพและคลิปจะใช้เวลาของเครื่อง ควรตั้ง NTP ที่เครื่องบันทึก' });
  });

  it('says hours for a clock off by more than an hour', async () => {
    const r = await translateCameraAlertToThai('Clock off: PC', `PC: clock is ${describeDrift(-17853)} (limit 60 s). Footage and clips carry the recorder's time; set NTP on the recorder.`);
    expect(r.message).toContain('ช้ากว่า Server 4 ชั่วโมง 57 นาที');
  });

  it('translates the one notice a round sends for many clocks, as clockRoundNotice builds it', async () => {
    const raised = Array.from({ length: 22 }, (_, i) => ({ source: `d${i}`, name: `R${i}`, title: '', message: '', driftSeconds: i === 0 ? -684 : 90 }));
    const notice = clockRoundNotice(raised)!;
    const out = await translateCameraAlertToThai(notice.title, notice.message);
    expect(out.title).toBe('เวลาเครื่องบันทึกไม่ตรง 22 เครื่อง');
    const lines = out.message.split('\n');
    expect(lines[1]).toBe('- R0: ช้ากว่า Server 11 นาที 24 วินาที');
    expect(lines[lines.length - 1]).toBe('- ...และอีก 2 เครื่อง');
    expect(out.message).not.toMatch(/ahead of|behind|more$/);
  });

  it('translates a whole recorder going down and coming back', async () => {
    const down = await translateCameraAlertToThai('Recorder offline: DVR Store', 'Recorder "DVR Store" (192.168.30.203) is not answering, so none of its 8 cameras can be seen. This one alert stands for all of them.');
    expect(down).toEqual({ title: 'เครื่องบันทึกไม่ตอบ: DVR Store', message: 'เครื่องบันทึก "DVR Store" (192.168.30.203) ไม่ตอบ ดูภาพกล้องทั้ง 8 ตัวของเครื่องนี้ไม่ได้ แจ้งเตือนนี้แทนทุกกล้องในเครื่อง' });
    const back = await translateCameraAlertToThai('Recorder online: DVR Store', 'Recorder "DVR Store" is answering again. Downtime: 3m 10s. 1 camera(s) on it are still down and are reported on their own from now.');
    expect(back.title).toBe('เครื่องบันทึกกลับมาแล้ว: DVR Store');
    expect(back.message).toBe('เครื่องบันทึก "DVR Store" กลับมาตอบแล้ว ระยะเวลาที่ดาวน์: 3 นาที 10 วินาที ยังมีกล้อง 1 ตัวในเครื่องนี้ที่ยังดับ จะแจ้งแยกรายกล้องต่อจากนี้');
  });

  it('keeps unknown alerts untouched', async () => {
    expect(await translateCameraAlertToThai('Something new', 'raw text')).toEqual({ title: 'Something new', message: 'raw text' });
  });
});
