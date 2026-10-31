/**
 * One-off backfill [R1.1]: encrypt camera RTSP URLs that were stored with plaintext credentials.
 *
 * Dry run by default (reports counts only, never prints URLs). Apply with --apply,
 * only against a verified Dev DB that has a fresh backup (AGENTS.md rule 6).
 *
 *   npx tsx prisma/seal-rtsp-credentials.ts            # dry run
 *   npx tsx prisma/seal-rtsp-credentials.ts --apply    # write
 */
import { PrismaClient } from '@prisma/client';

// The runtime image ships dist/ only; a dev checkout has src/
const { sealRtspUrl } = await import('../dist/lib/rtsp-credentials.js').catch(
  () => import('../src/lib/rtsp-credentials.js'),
);

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const cameras = await prisma.camera.findMany({
    where: { OR: [{ rtspUrl: { not: null } }, { rtspUrlSub: { not: null } }] },
    select: { id: true, rtspUrl: true, rtspUrlSub: true },
  });

  let pending = 0;
  for (const cam of cameras) {
    const rtspUrl = sealRtspUrl(cam.rtspUrl) ?? null;
    const rtspUrlSub = sealRtspUrl(cam.rtspUrlSub) ?? null;
    // sealRtspUrl re-encrypts already sealed values, so only touch rows that still hold a raw rtsp:// URL with credentials
    const mainChanged = Boolean(cam.rtspUrl?.startsWith('rtsp') && rtspUrl !== cam.rtspUrl);
    const subChanged = Boolean(cam.rtspUrlSub?.startsWith('rtsp') && rtspUrlSub !== cam.rtspUrlSub);
    if (!mainChanged && !subChanged) continue;

    pending++;
    if (apply) {
      await prisma.camera.update({
        where: { id: cam.id },
        data: {
          ...(mainChanged ? { rtspUrl } : {}),
          ...(subChanged ? { rtspUrlSub } : {}),
        },
      });
    }
  }

  console.log(`${apply ? 'Sealed' : 'Would seal'} ${pending} of ${cameras.length} cameras with RTSP URLs`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
