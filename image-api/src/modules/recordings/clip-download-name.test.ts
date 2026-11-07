import { describe, expect, it } from 'vitest';
import { clipDownloadName } from './clip-download-name.js';

describe('clipDownloadName', () => {
  it('uses the title', () => {
    expect(clipDownloadName('STR-Ch5-2026-11-01_091127', 'x.mp4')).toBe('STR-Ch5-2026-11-01_091127.mp4');
  });

  it('keeps Thai and removes what a file system rejects', () => {
    expect(clipDownloadName('หน้าโรงงาน: ประตู/1', 'x.mp4')).toBe('หน้าโรงงาน_ ประตู_1.mp4');
  });

  it('falls back to the stored file name when there is no title', () => {
    expect(clipDownloadName('   ', 'x.mp4')).toBe('x.mp4');
    expect(clipDownloadName(null, 'x.mp4')).toBe('x.mp4');
  });
});
