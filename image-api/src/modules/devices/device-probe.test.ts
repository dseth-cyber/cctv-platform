import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeDeviceConnection } from './devices.service.js';

// The device form reads overallStatus and reachability while rendering: a missing field blanks the page.
describe('probeDeviceConnection', () => {
  const listen = () => new Promise<net.Server>((resolve) => {
    const server = net.createServer((socket) => socket.destroy());
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const portOf = (server: net.Server) => (server.address() as AddressInfo).port;
  let a: net.Server;
  let b: net.Server;
  let closedPort: number;

  beforeAll(async () => {
    a = await listen();
    b = await listen();
    const closed = await listen();
    closedPort = portOf(closed);
    await new Promise((resolve) => closed.close(resolve));
  });
  afterAll(async () => {
    await Promise.all([a, b].map((server) => new Promise((resolve) => server.close(resolve))));
  });

  it('says online when both ports answer', async () => {
    const out = await probeDeviceConnection('127.0.0.1', portOf(a), portOf(b));
    expect(out.overallStatus).toBe('online');
    expect(out.reachable).toBe(true);
    expect(out.reachability.rtsp.reachable).toBe(true);
    expect(out.reachability.http.reachable).toBe(true);
    expect(out.reachability.rtsp.latencyMs).toEqual(expect.any(Number));
  });

  it('says degraded when only one answers, and which one', async () => {
    const out = await probeDeviceConnection('127.0.0.1', closedPort, portOf(b));
    expect(out.overallStatus).toBe('degraded');
    expect([out.reachability.rtsp.reachable, out.reachability.http.reachable]).toEqual([false, true]);
    expect([out.rtspOpen, out.httpOpen]).toEqual([false, true]);
  });

  it('says offline when neither answers', async () => {
    const out = await probeDeviceConnection('127.0.0.1', closedPort, closedPort);
    expect(out.overallStatus).toBe('offline');
    expect(out.reachable).toBe(false);
    expect(out.reachability.rtsp.reachable).toBe(false);
  });
});
