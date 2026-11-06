import { describe, expect, it } from 'vitest';
import { parseChannelList, parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('comes back unchanged, with Thai, commas, quotes and line breaks', () => {
    const rows = [{ name: 'DVR แผนกสโตร์', description: 'ชั้น 1, "ฝั่งซ้าย"\nใกล้ประตู', totalchannels: '8' }];
    expect(parseCsv(toCsv(['name', 'description', 'totalchannels'], rows))).toEqual(rows);
  });

  it('keeps a spreadsheet from running a cell as a formula, and reads it back as typed', () => {
    const csv = toCsv(['name'], [{ name: '=HYPERLINK("http://x")' }]);
    expect(csv.split('\r\n')[1].startsWith('"\'=')).toBe(true);
    expect(parseCsv(csv)[0].name).toBe('=HYPERLINK("http://x")');
  });

  it('reads a file saved by Excel: byte order mark, mixed-case headers, blank lines', () => {
    expect(parseCsv('﻿Name,IpAddress\r\nA,10.0.0.1\r\n\r\n,\r\nB,10.0.0.2')).toEqual([
      { name: 'A', ipaddress: '10.0.0.1' },
      { name: 'B', ipaddress: '10.0.0.2' },
    ]);
  });

  it('treats a missing cell as empty', () => {
    expect(parseCsv('a,b\n1')).toEqual([{ a: '1', b: '' }]);
  });

  it('reads a channel list and refuses nonsense', () => {
    expect(parseChannelList('1;3;5')).toEqual([1, 3, 5]);
    expect(parseChannelList('')).toBeUndefined();
    expect(parseChannelList(undefined)).toBeUndefined();
    expect(parseChannelList('1;x')).toBeUndefined();
  });
});
