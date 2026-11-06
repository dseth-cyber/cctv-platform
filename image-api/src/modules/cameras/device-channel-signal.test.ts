import { describe, expect, it, vi, beforeEach } from 'vitest';

const digestGet = vi.fn();
vi.mock('../../lib/digest-fetch.js', () => ({ digestGet: (...a: unknown[]) => digestGet(...a) }));
vi.mock('../../lib/encryption.js', () => ({ decrypt: () => 'secret' }));
vi.mock('../../lib/logger.js', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

const { isKnownNoSignal, parseAnalogNoVideo, parseIpChannelsOffline, readChannelsWithoutSignal } = await import('./device-channel-signal.js');

// As returned by the real DS-7208HQHI-K1
const ANALOG = `<VideoInputChannelList><VideoInputChannel version="1.0"><id>1</id><resDesc>1080P25</resDesc></VideoInputChannel><VideoInputChannel version="1.0"><id>2</id><resDesc>NO VIDEO</resDesc></VideoInputChannel></VideoInputChannelList>`;
const device = (id: string, brand = 'Hikvision') => ({ id, brand, ipAddress: '10.0.0.1', httpPort: 80, username: 'u', passwordEncrypted: `sealed-${id}` });
const answer = (status: number, body = '') => ({ status, body: Buffer.from(body) });

describe('device channel signal', () => {
  beforeEach(() => digestGet.mockReset());

  it('reads the channels a recorder reports without a picture', () => {
    expect(parseAnalogNoVideo(ANALOG)).toEqual([2]);
    expect(parseIpChannelsOffline('<InputProxyChannelStatus><id>3</id><online>false</online></InputProxyChannelStatus><InputProxyChannelStatus><id>4</id><online>true</online></InputProxyChannelStatus>')).toEqual([3]);
  });

  it('reports the channel and asks each recorder once however many cameras it has', async () => {
    digestGet.mockResolvedValueOnce(answer(200, ANALOG)).mockResolvedValueOnce(answer(403));
    const d = device('a');
    const result = await readChannelsWithoutSignal([d, d, d]);
    expect([...result.get('a')!]).toEqual([2]);
    expect(digestGet).toHaveBeenCalledTimes(2);
  });

  it('leaves a recorder that cannot be asked as unknown, so nothing is marked offline', async () => {
    digestGet.mockRejectedValue(new Error('timeout'));
    expect((await readChannelsWithoutSignal([device('b')])).has('b')).toBe(false);
    digestGet.mockReset();
    digestGet.mockResolvedValue(answer(503));
    expect((await readChannelsWithoutSignal([device('c')])).has('c')).toBe(false);
  });

  it('stops asking after a refused login', async () => {
    digestGet.mockResolvedValue(answer(401));
    const d = device('d');
    await readChannelsWithoutSignal([d]);
    await readChannelsWithoutSignal([d]);
    expect(digestGet).toHaveBeenCalledTimes(1);
  });

  it('remembers the latest answer only while the recorder can still be asked', async () => {
    digestGet.mockResolvedValueOnce(answer(200, ANALOG)).mockResolvedValueOnce(answer(403));
    await readChannelsWithoutSignal([device('f')]);
    expect(isKnownNoSignal('f', 2)).toBe(true);
    expect(isKnownNoSignal('f', 1)).toBe(false);
    digestGet.mockRejectedValue(new Error('timeout'));
    await readChannelsWithoutSignal([device('f')]);
    expect(isKnownNoSignal('f', 2)).toBe(false);
    digestGet.mockReset();
  });

  it('asks only brands whose answer is known', async () => {
    await readChannelsWithoutSignal([device('e', 'Dahua'), null, undefined]);
    expect(digestGet).not.toHaveBeenCalled();
  });
});
