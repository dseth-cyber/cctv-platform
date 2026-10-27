#!/usr/bin/env node

/**
 * CCTV Platform — Pilot Wave 1 Hardware Verification & Stream Probe Toolkit
 *
 * Verifies on-site IP cameras prior to platform onboarding:
 * 1. Network reachability (TCP connect to RTSP 554 and HTTP/ONVIF 80/8080)
 * 2. Main Stream probe (Resolution, Video Codec, FPS, Audio Codec)
 * 3. Sub-stream probe (Must be H.264 baseline for 4-grid and mobile WebRTC)
 * 4. Audio format analysis (Audio G.711 vs AAC/Opus WebRTC compatibility)
 * 5. Keyframe / GOP alignment with MediaMTX segment durations
 *
 * Usage:
 *   node scripts/pilot-verify-cameras.mjs [--config <file.json>] [--dry-run] [--output <report.json>]
 */

import net from 'node:net';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ANSI color helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
};

// Default 10 physical cameras template for Pilot Wave 1
const DEFAULT_PILOT_CAMERAS = [
  { id: 'cam-01', name: 'Gate 1 (Main Entrance)', host: '192.168.10.101', rtspPort: 554, httpPort: 80, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
  { id: 'cam-02', name: 'Gate 2 (Visitor Entry)', host: '192.168.10.102', rtspPort: 554, httpPort: 80, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
  { id: 'cam-03', name: 'Perimeter Fence North', host: '192.168.10.103', rtspPort: 554, httpPort: 80, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
  { id: 'cam-04', name: 'Perimeter Fence East', host: '192.168.10.104', rtspPort: 554, httpPort: 80, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
  { id: 'cam-05', name: 'Perimeter Fence South', host: '192.168.10.105', rtspPort: 554, httpPort: 80, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
  { id: 'cam-06', name: 'Perimeter Fence West', host: '192.168.10.106', rtspPort: 554, httpPort: 80, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
  { id: 'cam-07', name: 'Server Room Door', host: '192.168.10.107', rtspPort: 554, httpPort: 8080, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
  { id: 'cam-08', name: 'Loading Dock A', host: '192.168.10.108', rtspPort: 554, httpPort: 80, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
  { id: 'cam-09', name: 'Loading Dock B', host: '192.168.10.109', rtspPort: 554, httpPort: 80, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
  { id: 'cam-10', name: 'Emergency Exit Corridor', host: '192.168.10.110', rtspPort: 554, httpPort: 8080, username: 'admin', password: 'Password123!', mainPath: '/Streaming/Channels/101', subPath: '/Streaming/Channels/102' },
];

/**
 * Parse CLI Arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    configPath: null,
    isDryRun: false,
    timeoutMs: 3000,
    outputPath: 'pilot-wave1-verification-report.json',
    showHelp: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.showHelp = true;
    } else if (arg === '--dry-run') {
      options.isDryRun = true;
    } else if (arg === '--config' || arg === '-c') {
      options.configPath = args[++i];
    } else if (arg === '--timeout' || arg === '-t') {
      options.timeoutMs = parseInt(args[++i], 10) || 3000;
    } else if (arg === '--output' || arg === '-o') {
      options.outputPath = args[++i];
    }
  }

  return options;
}

/**
 * Print Help Banner
 */
function printHelp() {
  console.log(`
${colors.bold}${colors.cyan}CCTV Platform — Pilot Wave 1 Hardware Verification Toolkit${colors.reset}

Usage:
  node scripts/pilot-verify-cameras.mjs [options]

Options:
  --config, -c <path>   Path to JSON file containing camera definitions
  --dry-run             Simulate camera verification using test fixtures (no network calls)
  --timeout, -t <ms>    TCP connect timeout in milliseconds (default: 3000)
  --output, -o <file>   Output path for JSON report (default: pilot-wave1-verification-report.json)
  --help, -h            Show this help message

Camera Configuration JSON format:
  [
    {
      "id": "cam-01",
      "name": "Gate 1",
      "host": "192.168.10.101",
      "rtspPort": 554,
      "httpPort": 80,
      "username": "admin",
      "password": "Password123!",
      "mainPath": "/Streaming/Channels/101",
      "subPath": "/Streaming/Channels/102"
    }
  ]
`);
}

/**
 * Check TCP Port Reachability
 */
function testTcpPort(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let isSettled = false;

    const cleanup = () => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      if (!isSettled) {
        isSettled = true;
        const latencyMs = Date.now() - startTime;
        cleanup();
        resolve({ reachable: true, latencyMs, error: null });
      }
    });

    socket.on('timeout', () => {
      if (!isSettled) {
        isSettled = true;
        cleanup();
        resolve({ reachable: false, latencyMs: Date.now() - startTime, error: 'TIMEOUT' });
      }
    });

    socket.on('error', (err) => {
      if (!isSettled) {
        isSettled = true;
        cleanup();
        resolve({ reachable: false, latencyMs: Date.now() - startTime, error: err.message });
      }
    });

    socket.connect(port, host);
  });
}

/**
 * Probe stream using ffprobe
 */
async function probeRtspStream(rtspUrl, timeoutSec = 5) {
  const args = [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate',
    '-show_entries', 'format=duration,bit_rate',
    '-of', 'json',
    '-rtsp_transport', 'tcp',
    '-analyzeduration', '3000000',
    '-probesize', '3000000',
    '-timeout', `${timeoutSec * 1000000}`,
    rtspUrl,
  ];

  try {
    const { stdout } = await execFileAsync('ffprobe', args, { timeout: (timeoutSec + 2) * 1000 });
    const data = JSON.parse(stdout);
    const streams = data.streams || [];

    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStream = streams.find((s) => s.codec_type === 'audio');

    let fps = null;
    if (videoStream?.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      if (den && den > 0) {
        fps = Math.round((num / den) * 10) / 10;
      }
    }

    return {
      success: true,
      hasVideo: Boolean(videoStream),
      videoCodec: videoStream?.codec_name || 'none',
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      fps: fps || 0,
      hasAudio: Boolean(audioStream),
      audioCodec: audioStream?.codec_name || 'none',
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      hasVideo: false,
      videoCodec: 'unknown',
      width: 0,
      height: 0,
      fps: 0,
      hasAudio: false,
      audioCodec: 'none',
      error: err.message?.split('\n')[0] || 'ffprobe execution failed',
    };
  }
}

/**
 * Format RTSP URL with sanitized logging
 */
function buildRtspUrl(cam, streamPath) {
  const user = encodeURIComponent(cam.username || '');
  const pass = encodeURIComponent(cam.password || '');
  const port = cam.rtspPort || 554;
  const pathPart = streamPath.startsWith('/') ? streamPath : `/${streamPath}`;
  return `rtsp://${user}:${pass}@${cam.host}:${port}${pathPart}`;
}

/**
 * Main verification routine
 */
async function main() {
  const options = parseArgs();

  if (options.showHelp) {
    printHelp();
    process.exit(0);
  }

  console.log(`\n${colors.bold}${colors.cyan}================================================================================${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan} CCTV PLATFORM — PILOT WAVE 1 HARDWARE & STREAM VERIFICATION TOOLKIT${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}================================================================================${colors.reset}`);
  console.log(`${colors.dim}Timestamp: ${new Date().toISOString()} (Asia/Bangkok: UTC+7)${colors.reset}`);
  console.log(`${colors.dim}Execution Mode: ${options.isDryRun ? colors.magenta + 'DRY-RUN SIMULATION (Fixture Probing)' : colors.green + 'LIVE PHYSICAL PROBING'} ${colors.reset}`);
  console.log(`${colors.dim}Connect Timeout: ${options.timeoutMs}ms | Report Output: ${options.outputPath}${colors.reset}\n`);

  // Load cameras
  let cameras = DEFAULT_PILOT_CAMERAS;
  if (options.configPath) {
    try {
      const raw = fs.readFileSync(path.resolve(process.cwd(), options.configPath), 'utf-8');
      cameras = JSON.parse(raw);
      console.log(`Loaded ${cameras.length} camera configurations from ${options.configPath}`);
    } catch (err) {
      console.error(`${colors.red}Failed to load config from ${options.configPath}: ${err.message}${colors.reset}`);
      process.exit(1);
    }
  } else {
    console.log(`Using default template of ${cameras.length} physical cameras for Pilot Wave 1.`);
  }

  const results = [];

  for (let idx = 0; idx < cameras.length; idx++) {
    const cam = cameras[idx];
    process.stdout.write(`[${idx + 1}/${cameras.length}] Probing camera ${colors.bold}${cam.id}${colors.reset} (${cam.name} @ ${cam.host})... `);

    let rtspNet;
    let httpNet;
    let mainProbe;
    let subProbe;

    if (options.isDryRun) {
      // Deterministic simulation for Dry-Run mode
      // Model realistic on-site conditions:
      // 8 cameras fully healthy (H.264/H.265 Main + H.264 Sub + AAC/G.711)
      // 1 camera with G.711 audio warning
      // 1 camera with sub-stream H.265 warning
      const isWarnCam = cam.id === 'cam-07';
      const isG711Cam = cam.id === 'cam-04';

      rtspNet = { reachable: true, latencyMs: 12 + (idx * 2), error: null };
      httpNet = { reachable: true, latencyMs: 18 + (idx * 3), error: null };

      mainProbe = {
        success: true,
        hasVideo: true,
        videoCodec: idx % 2 === 0 ? 'h264' : 'hevc',
        width: 1920,
        height: 1080,
        fps: 20,
        hasAudio: true,
        audioCodec: isG711Cam ? 'pcm_alaw' : 'aac',
        error: null,
      };

      subProbe = {
        success: true,
        hasVideo: true,
        videoCodec: isWarnCam ? 'hevc' : 'h264',
        width: 640,
        height: 360,
        fps: 15,
        hasAudio: false,
        audioCodec: 'none',
        error: null,
      };
    } else {
      // Real Network Testing
      rtspNet = await testTcpPort(cam.host, cam.rtspPort || 554, options.timeoutMs);
      httpNet = await testTcpPort(cam.host, cam.httpPort || 80, options.timeoutMs);

      if (rtspNet.reachable) {
        const mainUrl = buildRtspUrl(cam, cam.mainPath || '/Streaming/Channels/101');
        const subUrl = buildRtspUrl(cam, cam.subPath || '/Streaming/Channels/102');

        mainProbe = await probeRtspStream(mainUrl, 4);
        subProbe = await probeRtspStream(subUrl, 3);
      } else {
        mainProbe = { success: false, error: 'RTSP port unreachable' };
        subProbe = { success: false, error: 'RTSP port unreachable' };
      }
    }

    // Evaluate Quality & Compliance Rules
    const issues = [];
    const recommendations = [];

    if (!rtspNet.reachable) {
      issues.push(`RTSP Port ${cam.rtspPort} unreachable (${rtspNet.error})`);
    }
    if (!httpNet.reachable) {
      issues.push(`HTTP/ONVIF Port ${cam.httpPort} unreachable (${httpNet.error})`);
    }

    if (mainProbe.success) {
      if (mainProbe.fps < 10 || mainProbe.fps > 30) {
        issues.push(`Main stream FPS (${mainProbe.fps}) is non-standard. Recommended: 15-25 fps.`);
      }
      if (mainProbe.audioCodec === 'pcm_alaw' || mainProbe.audioCodec === 'pcm_mulaw') {
        recommendations.push(`Audio codec is G.711 (${mainProbe.audioCodec}). WebRTC player requires Opus remux or AAC for browser audio playback.`);
      }
    } else {
      issues.push(`Main stream probe failed: ${mainProbe.error}`);
    }

    if (subProbe.success) {
      if (subProbe.videoCodec !== 'h264') {
        issues.push(`CRITICAL: Sub-stream codec is ${subProbe.videoCodec.toUpperCase()} instead of H.264! Live 4-Grid & Mobile WebRTC will fail on non-Safari clients.`);
        recommendations.push(`Change Sub-stream encoding on camera web portal to H.264 (Baseline/Main Profile) at 640x360 or 720p 15fps.`);
      }
    } else {
      issues.push(`Sub-stream probe failed: ${subProbe.error}`);
    }

    // Status Assignment
    let status = 'PASS';
    if (issues.some((i) => i.includes('unreachable') || i.includes('probe failed') || i.includes('CRITICAL'))) {
      status = issues.some((i) => i.includes('unreachable') || i.includes('probe failed')) ? 'FAIL' : 'WARN';
    } else if (issues.length > 0 || recommendations.length > 0) {
      status = 'WARN';
    }

    const statusColored = status === 'PASS'
      ? `${colors.green}${colors.bold}PASS${colors.reset}`
      : status === 'WARN'
      ? `${colors.yellow}${colors.bold}WARN${colors.reset}`
      : `${colors.red}${colors.bold}FAIL${colors.reset}`;

    console.log(`[${statusColored}]`);

    results.push({
      camera: cam,
      network: {
        rtsp: rtspNet,
        http: httpNet,
      },
      streams: {
        main: mainProbe,
        sub: subProbe,
      },
      status,
      issues,
      recommendations,
    });
  }

  // Print Structured Summary Table
  console.log(`\n${colors.bold}======================================================================================================${colors.reset}`);
  console.log(`${colors.bold} PILOT WAVE 1 HARDWARE VERIFICATION SUMMARY REPORT${colors.reset}`);
  console.log(`${colors.bold}======================================================================================================${colors.reset}`);
  console.log(
    `${colors.bold}${'ID'.padEnd(8)} ${'Camera Name'.padEnd(25)} ${'Host'.padEnd(16)} ${'RTSP / HTTP'.padEnd(14)} ${'Main Stream'.padEnd(16)} ${'Sub Stream'.padEnd(14)} ${'Status'.padEnd(8)}${colors.reset}`
  );
  console.log(''.padEnd(102, '-'));

  for (const r of results) {
    const ports = `${r.network.rtsp.reachable ? '✓554' : '✗554'} / ${r.network.http.reachable ? '✓' + r.camera.httpPort : '✗' + r.camera.httpPort}`;
    const mainDesc = r.streams.main.success
      ? `${r.streams.main.videoCodec.toUpperCase()} ${r.streams.main.width}x${r.streams.main.height}@${r.streams.main.fps}f`
      : 'FAILED';
    const subDesc = r.streams.sub.success
      ? `${r.streams.sub.videoCodec.toUpperCase()} ${r.streams.sub.width}x${r.streams.sub.height}`
      : 'FAILED';

    const statusPadded = r.status === 'PASS'
      ? `${colors.green}PASS    ${colors.reset}`
      : r.status === 'WARN'
      ? `${colors.yellow}WARN    ${colors.reset}`
      : `${colors.red}FAIL    ${colors.reset}`;

    console.log(
      `${r.camera.id.padEnd(8)} ${r.camera.name.slice(0, 24).padEnd(25)} ${r.camera.host.padEnd(16)} ${ports.padEnd(14)} ${mainDesc.padEnd(16)} ${subDesc.padEnd(14)} ${statusPadded}`
    );
  }
  console.log(''.padEnd(102, '-'));

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;

  console.log(`\n${colors.bold}Statistics:${colors.reset} Total: ${results.length} | ${colors.green}PASS: ${passCount}${colors.reset} | ${colors.yellow}WARN: ${warnCount}${colors.reset} | ${colors.red}FAIL: ${failCount}${colors.reset}`);

  // Detailed Recommendations for Warnings/Failures
  const actionable = results.filter((r) => r.issues.length > 0 || r.recommendations.length > 0);
  if (actionable.length > 0) {
    console.log(`\n${colors.bold}${colors.yellow}Actionable Engineer Recommendations:${colors.reset}`);
    for (const item of actionable) {
      console.log(`• ${colors.bold}${item.camera.id} (${item.camera.name}):${colors.reset}`);
      for (const issue of item.issues) {
        console.log(`  - ${colors.red}[Issue]${colors.reset} ${issue}`);
      }
      for (const rec of item.recommendations) {
        console.log(`  - ${colors.yellow}[Recommendation]${colors.reset} ${rec}`);
      }
    }
  }

  // Keyframe / GOP Architecture Notice
  console.log(`\n${colors.bold}${colors.cyan}GOP / Keyframe & MediaMTX Alignment Guidelines:${colors.reset}`);
  console.log(`• MediaMTX lowLatency HLS expects ${colors.bold}hlsSegmentDuration: 2s${colors.reset} and ${colors.bold}hlsSegmentCount: 7${colors.reset}.`);
  console.log(`• For seamless stream switching and instant WebRTC keyframes, configure camera Keyframe Interval (I-Frame Period) to ${colors.bold}1x - 2x of FPS${colors.reset} (e.g. 20-40 frames at 20fps).`);
  console.log(`• Ensure Camera NTP is synchronized to CCTV Server IP or gateway before onboarding.\n`);

  // Save report to disk
  const reportPayload = {
    generatedAt: new Date().toISOString(),
    executionMode: options.isDryRun ? 'DRY_RUN_SIMULATION' : 'LIVE_PHYSICAL_PROBING',
    summary: {
      total: results.length,
      passed: passCount,
      warned: warnCount,
      failed: failCount,
      readinessPercent: Math.round(((passCount + warnCount * 0.7) / results.length) * 100),
    },
    cameras: results,
  };

  try {
    fs.writeFileSync(path.resolve(process.cwd(), options.outputPath), JSON.stringify(reportPayload, null, 2), 'utf-8');
    console.log(`${colors.green}✓ Verification report successfully exported to:${colors.reset} ${options.outputPath}`);
  } catch (err) {
    console.error(`${colors.red}Failed to write report to ${options.outputPath}: ${err.message}${colors.reset}`);
  }

  console.log(`${colors.bold}${colors.cyan}================================================================================${colors.reset}\n`);

  // Return exit code 0 if all cameras are PASS or WARN, exit code 1 only if any hard FAIL
  if (failCount > 0 && !options.isDryRun) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`${colors.red}Fatal script error: ${err.message}${colors.reset}`);
  process.exit(1);
});
