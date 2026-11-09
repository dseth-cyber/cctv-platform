import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digestGet, digestPut } from '../../lib/digest-fetch.js';
import {
  ntpRefusal, ntpServerXml, ntpTimeXml, parseNtpReply, pointRecorderAtNtp, readTimeSettings, recorderAccepted, RecorderNtpError,
} from './recorder-ntp.js';

const mockPrisma = { device: { findUnique: vi.fn() } };
const config = { server: '192.168.30.77' };
const ntp = vi.hoisted(() => ({ answer: null as any }));

vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));
vi.mock('../../lib/encryption.js', () => ({ decrypt: () => 'pw' }));
vi.mock('../../lib/digest-fetch.js', () => ({ digestGet: vi.fn(), digestPut: vi.fn() }));
vi.mock('../system-config/system-config.service.js', () => ({
  getAllConfigs: vi.fn(async () => ({ device_ntp_server: { value: config.server }, device_ntp_sync_minutes: { value: 60 } })),
}));
vi.mock('node:dgram', () => ({
  default: {
    createSocket: () => {
      const handlers: Record<string, (m: Buffer) => void> = {};
      return {
        on: (e: string, f: (m: Buffer) => void) => { handlers[e] = f; },
        close: () => {},
        send: () => {
          if (!ntp.answer) return;
          const reply = Buffer.alloc(48);
          reply[0] = (ntp.answer.leap ?? 0) << 6;
          reply[1] = ntp.answer.stratum;
          const at = (Date.now() + (ntp.answer.offsetMs ?? 0)) / 1000 + 2_208_988_800;
          reply.writeUInt32BE(Math.floor(at), 40);
          setTimeout(() => handlers.message?.(reply), 1);
        },
      };
    },
  },
}));

const TIME = '<Time><timeMode>manual</timeMode><localTime>2026-11-09T08:00:02+07:00</localTime><timeZone>CST-7:00:00</timeZone></Time>';
const NTP = '<NTPServer><id>1</id><addressingFormatType>hostname</addressingFormatType><hostName></hostName><portNo>123</portNo><synchronizeInterval>60</synchronizeInterval></NTPServer>';
const ok = (body: string) => ({ status: 200, contentType: 'application/xml', body: Buffer.from(body) });
const DONE = '<ResponseStatus><statusCode>1</statusCode><statusString>OK</statusString></ResponseStatus>';

describe('the NTP reply', () => {
  it('reads stratum, leap and how far the server is from our clock', () => {
    const reply = Buffer.alloc(48);
    reply[0] = 0x24;
    reply[1] = 3;
    reply.writeUInt32BE(Math.floor(1_000_000 + 2_208_988_800), 40);
    expect(parseNtpReply(reply, 1_000_000_000 - 2000, 1_000_000_000)).toEqual({ leap: 0, stratum: 3, offsetMs: 1000 });
    expect(parseNtpReply(Buffer.alloc(10), 0, 0)).toBeNull();
  });

  it('hands out time only from a server that is checked against real time and agrees with ours', () => {
    expect(ntpRefusal({ leap: 0, stratum: 3, offsetMs: 40 })).toBeNull();
    expect(ntpRefusal(null)).toBe('NTP_SERVER_UNREACHABLE');
    expect(ntpRefusal({ leap: 0, stratum: 10, offsetMs: 0 })).toBe('NTP_SERVER_NOT_SYNCED');
    expect(ntpRefusal({ leap: 3, stratum: 3, offsetMs: 0 })).toBe('NTP_SERVER_NOT_SYNCED');
    expect(ntpRefusal({ leap: 0, stratum: 3, offsetMs: -9000 })).toBe('SERVER_CLOCK_OFF');
  });
});

describe('what is sent to the recorder', () => {
  it('names the server by address or by name', () => {
    expect(ntpServerXml('192.168.30.77', 60)).toContain('<addressingFormatType>ipaddress</addressingFormatType><ipAddress>192.168.30.77</ipAddress>');
    expect(ntpServerXml('ntp.local', 30)).toContain('<hostName>ntp.local</hostName><portNo>123</portNo><synchronizeInterval>30</synchronizeInterval>');
  });

  it('switches to NTP in Bangkok time without setting the clock by hand', () => {
    expect(ntpTimeXml()).toContain('<timeMode>NTP</timeMode><timeZone>CST-7:00:00</timeZone>');
    expect(ntpTimeXml()).not.toContain('localTime');
  });

  it('keeps what was there before', () => {
    expect(readTimeSettings(TIME, NTP)).toEqual({ mode: 'manual', timeZone: 'CST-7:00:00', localTime: '2026-11-09T08:00:02+07:00', ntpServer: null, ntpMinutes: 60 });
  });

  it('takes done and done-after-restart as done', () => {
    expect(recorderAccepted(200, DONE)).toBe(true);
    expect(recorderAccepted(200, '<ResponseStatus><statusCode>7</statusCode></ResponseStatus>')).toBe(true);
    expect(recorderAccepted(200, '<ResponseStatus><statusCode>4</statusCode></ResponseStatus>')).toBe(false);
    expect(recorderAccepted(403, DONE)).toBe(false);
  });
});

describe('pointRecorderAtNtp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.server = '192.168.30.77';
    ntp.answer = { stratum: 3, leap: 0, offsetMs: 0 };
    mockPrisma.device.findUnique.mockResolvedValue({ id: 'd1', name: 'DVR Store', brand: 'Hikvision', ipAddress: '10.0.0.5', httpPort: 80, username: 'admin', passwordEncrypted: 'enc' });
    vi.mocked(digestGet).mockImplementation(async (url: string) => ok(url.endsWith('ntpServers/1') ? NTP : TIME));
    vi.mocked(digestPut).mockResolvedValue(ok(DONE));
  });

  const refused = async () => {
    try {
      await pointRecorderAtNtp('d1');
    } catch (e) {
      return (e as RecorderNtpError).code;
    }
    return null;
  };

  it('sets the server first, then the mode, and reports before and after', async () => {
    const result = await pointRecorderAtNtp('d1');
    const puts = vi.mocked(digestPut).mock.calls.map(([url]) => url);
    expect(puts).toEqual(['http://10.0.0.5:80/ISAPI/System/time/ntpServers/1', 'http://10.0.0.5:80/ISAPI/System/time']);
    expect(result?.before.mode).toBe('manual');
    expect(result?.server).toBe('192.168.30.77');
  });

  it('sends nothing when no server is set', async () => {
    config.server = '';
    expect(await refused()).toBe('NTP_NOT_SET');
    expect(digestPut).not.toHaveBeenCalled();
  });

  it('sends nothing when the NTP server is not checked against real time', async () => {
    ntp.answer = { stratum: 10, leap: 0, offsetMs: 0 };
    expect(await refused()).toBe('NTP_SERVER_NOT_SYNCED');
    expect(digestPut).not.toHaveBeenCalled();
  });

  it('sends nothing when this server clock is off', async () => {
    ntp.answer = { stratum: 2, leap: 0, offsetMs: 30_000 };
    expect(await refused()).toBe('SERVER_CLOCK_OFF');
    expect(digestPut).not.toHaveBeenCalled();
  });

  it('carries on when the recorder answers 503 but did make the change', async () => {
    let server = '';
    vi.mocked(digestGet).mockImplementation(async (url: string) => ok(url.endsWith('ntpServers/1') ? NTP.replace('<hostName></hostName>', `<ipAddress>${server}</ipAddress>`) : TIME));
    vi.mocked(digestPut).mockImplementationOnce(async () => { server = '192.168.30.77'; return { status: 503, contentType: '', body: Buffer.from('<ResponseStatus><statusCode>3</statusCode><statusString>Device Error</statusString></ResponseStatus>') }; });
    await pointRecorderAtNtp('d1');
    expect(digestPut).toHaveBeenCalledTimes(2);
  });

  it('stops before the mode when the recorder refuses the server', async () => {
    vi.mocked(digestPut).mockResolvedValueOnce(ok('<ResponseStatus><statusCode>4</statusCode></ResponseStatus>'));
    expect(await refused()).toBe('RECORDER_REFUSED');
    expect(digestPut).toHaveBeenCalledTimes(1);
  });
});
