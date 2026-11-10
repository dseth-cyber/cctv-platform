import { describe, expect, it } from 'vitest';
import { pruneAck, setAck } from './health-notes-ack.js';

const at = new Date('2026-11-10T10:00:00Z');

describe('health note acknowledgements', () => {
  it('set and clear one note without touching the other', () => {
    const a = setAck(null, 'sub_recording', true, 'admin', at);
    const b = setAck(a, 'smart_codec', true, 'op', at);
    expect(b).toEqual({ sub_recording: { by: 'admin', at: at.toISOString() }, smart_codec: { by: 'op', at: at.toISOString() } });
    expect(setAck(b, 'sub_recording', false, 'admin', at)).toEqual({ smart_codec: { by: 'op', at: at.toISOString() } });
  });

  it('kept while the recorder still shows it, or was not read this round', () => {
    const ack = setAck(null, 'sub_recording', true, 'admin', at);
    expect(pruneAck(ack, { subRecordingChannels: [1, 2], smartCodecChannels: [] })).toBeNull();
    expect(pruneAck(ack, { subRecordingChannels: null, smartCodecChannels: null })).toBeNull();
  });

  it('dropped once the recorder no longer shows it, so it warns again if it comes back', () => {
    const ack = setAck(setAck(null, 'sub_recording', true, 'admin', at), 'smart_codec', true, 'admin', at);
    expect(pruneAck(ack, { subRecordingChannels: [], smartCodecChannels: [3] })).toEqual({ smart_codec: ack.smart_codec });
  });
});
