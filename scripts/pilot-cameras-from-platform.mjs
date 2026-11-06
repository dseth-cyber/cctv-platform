#!/usr/bin/env node

/**
 * Prints the pilot camera list for pilot-verify-cameras.mjs, using the logins already sealed in the
 * platform database, so no password ever sits in a file. Pipe it, never save it:
 *
 *   docker cp scripts/pilot-cameras-from-platform.mjs cctv-api:/tmp/
 *   docker cp scripts/pilot-verify-cameras.mjs cctv-api:/tmp/
 *   docker exec cctv-api sh -c 'node /tmp/pilot-cameras-from-platform.mjs <cameraId>... \
 *     | node /tmp/pilot-verify-cameras.mjs --config - --output /tmp/pilot-report.json'
 *
 * Runs inside the cctv-api container, which holds the key. Reads only.
 */

const { getPrisma } = await import('/app/dist/lib/prisma.js');
const { openRtspUrl } = await import('/app/dist/lib/rtsp-credentials.js');

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('Give the camera ids to include.');
  process.exit(2);
}

const prisma = getPrisma();
const rows = await prisma.camera.findMany({
  where: { id: { in: ids }, deletedAt: null },
  select: { id: true, name: true, rtspUrl: true, rtspUrlSub: true, device: { select: { httpPort: true } } },
});
const missing = ids.filter((id) => !rows.some((row) => row.id === id));
if (missing.length) {
  console.error(`Cameras not found: ${missing.join(', ')}`);
  process.exit(2);
}

// In the order asked for, so the report reads the same way each time.
const cameras = ids.map((id) => rows.find((row) => row.id === id)).map((row, index) => {
  const mainUrl = openRtspUrl(row.rtspUrl);
  const url = new URL(mainUrl);
  return {
    id: `cam-${String(index + 1).padStart(2, '0')}`,
    name: row.name,
    host: url.hostname,
    rtspPort: Number(url.port) || 554,
    httpPort: row.device?.httpPort ?? 80,
    mainUrl,
    subUrl: openRtspUrl(row.rtspUrlSub),
  };
});

process.stdout.write(JSON.stringify(cameras));
await prisma.$disconnect();
