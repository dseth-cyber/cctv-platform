// Reads only: how much each channel of one recorder really writes per day (main and sub streams), from its own
// file list (size per file), and how many days its disks then hold. Never prints a password.
// Run inside cctv-api (it uses the built app):
//   docker cp scripts/measure-recorded.mjs cctv-api:/app/m.mjs
//   docker exec -e IP=<recorder ip> -e HOURS=48 -w /app cctv-api node m.mjs; docker exec cctv-api rm -f /app/m.mjs
// Checked 2026-11-09 against what two recorders really hold: within 8-15% (a weekend window reads low).
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { decrypt } from '/app/dist/lib/encryption.js';
import { digestGet, digestPost } from '/app/dist/lib/digest-fetch.js';

const prisma = new PrismaClient();
const d = await prisma.device.findFirst({ where: { ipAddress: process.env.IP } });
const pw = decrypt(d.passwordEncrypted);
const base = `http://${d.ipAddress}:${d.httpPort ?? 80}`;
const hours = Number(process.env.HOURS ?? 48);
// The recorder's own wall clock (its search speaks it); stop 1 h short of now so the newest file is closed.
const timeXml = (await digestGet(`${base}/ISAPI/System/time`, d.username, pw, { timeoutMs: 8000, maxBytes: 20000 })).body.toString();
const local = timeXml.match(/<localTime>([^<]+)</)[1].slice(0, 19);
const wall = (ms) => new Date(ms).toISOString().slice(0, 19);
const endMs = new Date(local + 'Z').getTime() - 3600_000;
const startMs = endMs - hours * 3600_000;
const sec = (s) => new Date(s.replace('Z', '') + 'Z').getTime() / 1000;

async function files(ch, track = '01') {
  const out = [];
  const id = crypto.randomUUID();
  for (let page = 0; page < 20; page++) {
    const body = '<?xml version="1.0" encoding="UTF-8"?><CMSearchDescription>'
      + `<searchID>${id}</searchID><trackIDList><trackID>${ch}${track}</trackID></trackIDList>`
      + `<timeSpanList><timeSpan><startTime>${wall(startMs)}Z</startTime><endTime>${wall(endMs)}Z</endTime></timeSpan></timeSpanList>`
      + `<maxResults>40</maxResults><searchResultPostion>${page * 40}</searchResultPostion>`
      + '<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList></CMSearchDescription>';
    const r = await digestPost(`${base}/ISAPI/ContentMgmt/search`, d.username, pw, body, { timeoutMs: 20000, maxBytes: 2_000_000 });
    const x = r.body.toString();
    for (const m of x.matchAll(/<searchMatchItem>[\s\S]*?<\/searchMatchItem>/g)) {
      const it = m[0];
      const start = it.match(/<startTime>([^<]+)/)?.[1];
      const end = it.match(/<endTime>([^<]+)/)?.[1];
      const size = Number(it.match(/size=(\d+)/)?.[1]);
      const name = it.match(/name=(\d+)/)?.[1];
      if (start && end && size) out.push({ start: sec(start), end: sec(end), size, name });
    }
    if (!/<responseStatusStrg>MORE/i.test(x)) break;
    await new Promise((res) => setTimeout(res, 300));
  }
  return out;
}

const windowStart = startMs / 1000; const windowEnd = endMs / 1000;
let totalPerDay = 0;
const rows = [];
const TRACKS = (process.env.TRACKS ?? '01,02').split(',');
const byTrack = Object.fromEntries(TRACKS.map((t) => [t, 0]));
for (let ch = 1; ch <= (d.totalChannels ?? 16); ch++) for (const track of TRACKS) {
  const list = await files(ch, track);
  // A file cut by the window edge reports its whole size but only part of its time: rate from whole files only.
  const whole = list.filter((f) => f.start > windowStart + 1 && f.end < windowEnd - 1);
  const wholeBytes = whole.reduce((s, f) => s + f.size, 0);
  const wholeSecs = whole.reduce((s, f) => s + (f.end - f.start), 0);
  const recordedSecs = list.reduce((s, f) => s + (Math.min(f.end, windowEnd) - Math.max(f.start, windowStart)), 0);
  const rate = wholeSecs > 0 ? wholeBytes / wholeSecs : null; // bytes per recorded second
  const perDay = rate === null ? null : (rate * recordedSecs) / (hours / 24);
  if (perDay) { totalPerDay += perDay; byTrack[track] += perDay; }
  rows.push({ ch: `${ch}/${track === '01' ? 'main' : 'sub'}`, files: list.length, whole: whole.length, recordedPct: Math.round((recordedSecs / (hours * 3600)) * 100), mbps: rate === null ? null : +(rate * 8 / 1e6).toFixed(2), gbPerDay: perDay === null ? null : +(perDay / 1e9).toFixed(1) });
  await new Promise((res) => setTimeout(res, 300));
}
for (const r of rows) console.log(`ch${String(r.ch).padStart(7)} files=${r.files} whole=${r.whole} recorded=${r.recordedPct}% avg=${r.mbps ?? '-'} Mbps  ${r.gbPerDay ?? '-'} GB/day`);
const health = d.healthInfo ?? {};
const capacityBytes = (health.disks ?? []).reduce((s, k) => s + (k.capacityMB ?? 0) * 1024 * 1024, 0);
console.log(`window ${wall(startMs)} .. ${wall(endMs)} (recorder clock), ${hours} h`);
console.log('per stream GB/day:', Object.entries(byTrack).map(([t, v]) => `${t === '01' ? 'main' : 'sub'}=${(v / 1e9).toFixed(1)}`).join(' '));
console.log(`total ${(totalPerDay / 1e9).toFixed(1)} GB/day; disks ${(capacityBytes / 1e12).toFixed(2)} TB -> about ${(capacityBytes / totalPerDay).toFixed(0)} days; recorder says it holds ${health.retentionDays ?? '?'} days (oldest ${health.oldestRecording ?? '?'})`);
await prisma.$disconnect();
