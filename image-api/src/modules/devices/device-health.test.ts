import { describe, expect, it } from 'vitest';
import { guessDeviceType, parseContinuousChannels, parseDeviceInfo, parseDisks, parseInputProxies, parseProxyPasswordStatus, parseSmart, parseSmartCodecChannels, parseStreamingChannels, parseVideoInputs } from '../device-playback/hikvision-recorder.js';
import { clockIsOff, describeDrift, diskProblems } from './device-health.service.js';

const disk = (over: Record<string, unknown> = {}) => ({ id: '1', type: 'SATA', state: 'ok', capacityMB: 1000, freeMB: 0, smart: 'ok', temperature: 40, powerOnDays: 10, ...over });

describe('parseDeviceInfo', () => {
  it('reads what the recorder says about itself', () => {
    const xml = '<DeviceInfo><deviceName>x</deviceName><model>DS-7208HQHI-K1</model><serialNumber>ABC123</serialNumber><macAddress>84:9a:40:62:64:be</macAddress><firmwareVersion>V4.21.002</firmwareVersion></DeviceInfo>';
    expect(parseDeviceInfo(xml)).toEqual({ model: 'DS-7208HQHI-K1', serialNumber: 'ABC123', macAddress: '84:9a:40:62:64:be', firmwareVersion: 'V4.21.002', deviceType: 'dvr' });
  });

  it('gives nothing back for an answer that is not device info', () => {
    expect(parseDeviceInfo('<html>hello</html>')).toBeNull();
  });
});

describe('guessDeviceType', () => {
  it('goes by the model, because recorders report their own type as IPC', () => {
    expect(guessDeviceType('DS-7208HQHI-K1')).toBe('dvr');
    expect(guessDeviceType('iDS-7216HQHI-M2/S')).toBe('dvr');
    expect(guessDeviceType('DS-7216HQHI-K2')).toBe('dvr');
    expect(guessDeviceType('DS-7716NXI-K4(D)')).toBe('nvr');
    expect(guessDeviceType('DS-2CD2143G2-I')).toBe('ip_camera');
  });

  it('says nothing about a model it does not know', () => {
    expect(guessDeviceType('XYZ-100')).toBeNull();
    expect(guessDeviceType(null)).toBeNull();
  });
});

describe('parseDisks', () => {
  it('reads each disk', () => {
    const xml = '<hddList><hdd><id>1</id><hddType>SATA</hddType><status>ok</status><capacity>1907729</capacity><freeSpace>0</freeSpace></hdd><hdd><id>2</id><hddType>SATA</hddType><status>idle</status><capacity>11444224</capacity><freeSpace>11274240</freeSpace></hdd></hddList>';
    expect(parseDisks(xml)).toEqual([
      { id: '1', type: 'SATA', state: 'ok', capacityMB: 1907729, freeMB: 0 },
      { id: '2', type: 'SATA', state: 'idle', capacityMB: 11444224, freeMB: 11274240 },
    ]);
  });

  it('finds no disks in an empty list', () => {
    expect(parseDisks('<hddList></hddList>')).toEqual([]);
  });
});

describe('parseSmart', () => {
  it('reads the fields under their real, misspelt names', () => {
    expect(parseSmart('<SmartTestStatus><temprature>37</temprature><powerOnDay>3285</powerOnDay><selfEvaluaingStatus>ok</selfEvaluaingStatus></SmartTestStatus>')).toEqual({ smart: 'ok', temperature: 37, powerOnDays: 3285 });
  });

  it('copes with a recorder that says nothing', () => {
    expect(parseSmart('<x/>')).toEqual({ smart: null, temperature: null, powerOnDays: null });
  });
});

describe('parseContinuousChannels', () => {
  const track = (id: number, modes: string[]) => `<Track><id>${id}</id>${modes.map((m) => `<ScheduleAction><ActionRecordingMode>${m}</ActionRecordingMode></ScheduleAction>`).join('')}</Track>`;

  it('keeps main-stream tracks set to record all the time', () => {
    const channels = parseContinuousChannels(`<TrackList>${track(101, ['CMR', 'CMR'])}${track(102, ['CMR'])}${track(201, ['MOTION'])}${track(301, ['CMR', 'MOTION'])}</TrackList>`);
    expect([...(channels ?? [])]).toEqual([1]);
  });

  it('does not guess from an answer with no tracks', () => {
    expect(parseContinuousChannels('<TrackList></TrackList>')).toBeNull();
  });
});

describe('diskProblems', () => {
  it('finds nothing wrong with healthy disks, asleep or at work', () => {
    expect(diskProblems([disk(), disk({ state: 'idle', smart: null, temperature: null })] as any)).toEqual([]);
  });

  it('calls a recorder with no disks a problem', () => {
    expect(diskProblems([])).toEqual(['no_disk']);
  });

  it('names each kind of fault', () => {
    expect(diskProblems([disk({ state: 'error' })] as any)).toEqual(['disk_fault']);
    expect(diskProblems([disk({ smart: 'warning' })] as any)).toEqual(['disk_smart']);
    expect(diskProblems([disk({ temperature: 60 })] as any)).toEqual(['disk_hot']);
  });
});

describe('clockIsOff', () => {
  it('calls a clock off only past the limit, either way', () => {
    expect(clockIsOff(461, 60)).toBe(true);
    expect(clockIsOff(-61, 60)).toBe(true);
    expect(clockIsOff(60, 60)).toBe(false);
    expect(clockIsOff(-3, 60)).toBe(false);
  });

  it('says nothing without a reading or with the check off', () => {
    expect(clockIsOff(null, 60)).toBeNull();
    expect(clockIsOff(undefined, 60)).toBeNull();
    expect(clockIsOff(461, 0)).toBeNull();
  });

  it('words the difference for the alert', () => {
    expect(describeDrift(461)).toBe('ahead of the server by 7 min 41 s');
    expect(describeDrift(-200)).toBe('behind the server by 3 min 20 s');
  });
});

describe('parseSmartCodecChannels', () => {
  const channel = (id: number, smart: string | null) => `<StreamingChannel><id>${id}</id><Video><videoCodecType>H.265</videoCodecType>${smart === null ? '' : `<SmartCodec>${smart}</SmartCodec>`}</Video><Audio><enabled>true</enabled></Audio></StreamingChannel>`;

  it('lists main-stream channels with Smart Codec on, leaving out sub streams', () => {
    const xml = `<StreamingChannelList>${channel(101, '<enabled>true</enabled>')}${channel(102, '<enabled>true</enabled>')}${channel(201, '<enabled>false</enabled>')}${channel(301, '<enabled>true</enabled>')}</StreamingChannelList>`;
    expect(parseSmartCodecChannels(xml)).toEqual([1, 3]);
  });

  it('does not take an enabled from elsewhere in the channel for Smart Codec', () => {
    expect(parseSmartCodecChannels(`<StreamingChannelList>${channel(101, null)}${channel(201, '')}</StreamingChannelList>`)).toEqual([]);
  });
});

describe('camera spec parsers (shaped like what MD and NVR EOE answered)', () => {
  it('reads main and sub stream settings per channel', () => {
    const ch = (id: number, video: string) => `<StreamingChannel><id>${id}</id><Video>${video}</Video><Audio><enabled>true</enabled></Audio></StreamingChannel>`;
    const xml = `<StreamingChannelList>${ch(101, '<videoCodecType>H.265</videoCodecType><videoResolutionWidth>1920</videoResolutionWidth><videoResolutionHeight>1080</videoResolutionHeight><videoQualityControlType>VBR</videoQualityControlType><vbrUpperCap>1536</vbrUpperCap><maxFrameRate>1500</maxFrameRate><SmartCodec><enabled>true</enabled></SmartCodec>')}${ch(102, '<videoCodecType>H.264</videoCodecType><videoResolutionWidth>960</videoResolutionWidth><videoResolutionHeight>576</videoResolutionHeight><videoQualityControlType>CBR</videoQualityControlType><constantBitRate>512</constantBitRate><maxFrameRate>1200</maxFrameRate>')}</StreamingChannelList>`;
    expect(parseStreamingChannels(xml).get(1)).toEqual({
      main: { codec: 'H.265', width: 1920, height: 1080, fps: 15, bitrateKbps: 1536, rateControl: 'VBR', smartCodec: true },
      sub: { codec: 'H.264', width: 960, height: 576, fps: 12, bitrateKbps: 512, rateControl: 'CBR', smartCodec: false },
    });
  });

  it('reads the signal of each analog input', () => {
    const xml = '<VideoInputChannelList><VideoInputChannel><id>1</id><videoFormat>PAL</videoFormat><resDesc>1920*1080(1080P)P25</resDesc></VideoInputChannel><VideoInputChannel><id>14</id><videoFormat>PAL</videoFormat><enableWD1>true</enableWD1><resDesc>PAL</resDesc></VideoInputChannel></VideoInputChannelList>';
    expect([...parseVideoInputs(xml)]).toEqual([[1, '1920*1080(1080P)P25'], [14, 'PAL']]);
  });

  it('reads the IP camera behind an NVR channel, and how strong its password is', () => {
    const xml = '<InputProxyChannelList><InputProxyChannel><id>1</id><name>IPC</name><sourceInputPortDescriptor><proxyProtocol>ONVIF</proxyProtocol><addressingFormatType>ipaddress</addressingFormatType><ipAddress>192.168.10.31</ipAddress><managePortNo>80</managePortNo><userName>admin</userName><model>DH-IPC-HFW1230C-A</model><serialNumber>BK013E1PAG287A2</serialNumber><firmwareVersion>2.860.0000000.37.R</firmwareVersion></sourceInputPortDescriptor></InputProxyChannel></InputProxyChannelList>';
    expect(parseInputProxies(xml).get(1)).toEqual({ model: 'DH-IPC-HFW1230C-A', serialNumber: 'BK013E1PAG287A2', firmwareVersion: '2.860.0000000.37.R', ipAddress: '192.168.10.31', protocol: 'ONVIF' });
    const status = '<InputProxyChannelStatusList><InputProxyChannelStatus><id>1</id><online>true</online><SecurityStatus><PasswordStatus>strong</PasswordStatus></SecurityStatus></InputProxyChannelStatus><InputProxyChannelStatus><id>2</id><SecurityStatus><PasswordStatus>weak</PasswordStatus></SecurityStatus></InputProxyChannelStatus></InputProxyChannelStatusList>';
    expect([...parseProxyPasswordStatus(status)]).toEqual([[1, 'strong'], [2, 'weak']]);
  });
});
