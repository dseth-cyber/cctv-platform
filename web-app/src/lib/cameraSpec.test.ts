import { describe, expect, it } from 'vitest';
import { resolutionName, signalName, specNotes } from './cameraSpec';

const main = (over = {}) => ({ codec: 'H.265', width: 1920, height: 1080, fps: 15, bitrateKbps: 1536, rateControl: 'VBR', smartCodec: false, ...over });

describe('resolutionName', () => {
  it('names the common sizes and spells out the rest', () => {
    expect(resolutionName(1920, 1080)).toBe('1080p');
    expect(resolutionName(3840, 2160)).toBe('4K');
    expect(resolutionName(960, 576)).toBe('960×576');
    expect(resolutionName(null, 1080)).toBeNull();
  });
});

describe('signalName', () => {
  it('reads the forms the recorders use', () => {
    expect(signalName('1920*1080(1080P)P25')).toEqual({ text: '1080p 25fps', sd: false, none: false });
    expect(signalName('1080P25')).toEqual({ text: '1080p 25fps', sd: false, none: false });
    expect(signalName('PAL')).toEqual({ text: 'PAL', sd: true, none: false });
    expect(signalName('NO VIDEO')).toMatchObject({ none: true });
    expect(signalName(null)).toBeNull();
  });
});

describe('specNotes', () => {
  it('notes an old SD analog camera', () => {
    expect(specNotes({ main: main({ width: 960, height: 576 }), signal: 'PAL' })).toEqual(['sd_analog']);
  });

  it('notes a 1080p camera recorded at a smaller size (as HR ห้องบุคคล ch 1 was found)', () => {
    expect(specNotes({ main: main({ width: 960, height: 576 }), signal: '1080P25' })).toEqual(['recorded_below_camera']);
  });

  it('notes no signal, Smart Codec and a weak IP camera password', () => {
    expect(specNotes({ main: main(), signal: 'NO VIDEO' })).toEqual(['no_signal']);
    expect(specNotes({ main: main({ smartCodec: true }), signal: '1080P25' })).toEqual(['smart_codec']);
    expect(specNotes({ main: main(), ipCamera: { model: 'x', serialNumber: null, firmwareVersion: null, ipAddress: null, protocol: null, passwordStatus: 'weak' } })).toEqual(['weak_password']);
  });

  it('has nothing to say about a camera recorded as it sends', () => {
    expect(specNotes({ main: main(), signal: '1920*1080(1080P)P25' })).toEqual([]);
    expect(specNotes(null)).toEqual([]);
  });
});
