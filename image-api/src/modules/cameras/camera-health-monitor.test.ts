import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkAndRecordFlap,
  cameraFlapHistory,
  suggestRootCause,
  computeEscalatedPriority,
} from './camera-health-monitor.js';

describe('Camera Health Monitor & Alert Timing [AUDIT-HIGH-08]', () => {
  beforeEach(() => {
    cameraFlapHistory.clear();
  });

  describe('Flapping Suppression', () => {
    it('does not throttle when offline transitions are below maxFlaps threshold', () => {
      const camId = 'cam-001';
      expect(checkAndRecordFlap(camId, 15 * 60 * 1000, 3)).toBe(false);
      expect(checkAndRecordFlap(camId, 15 * 60 * 1000, 3)).toBe(false);
    });

    it('triggers flapping suppression after reaching maxFlaps (3 transitions within window)', () => {
      const camId = 'cam-002';
      expect(checkAndRecordFlap(camId, 15 * 60 * 1000, 3)).toBe(false);
      expect(checkAndRecordFlap(camId, 15 * 60 * 1000, 3)).toBe(false);
      // 3rd transition triggers flapping suppression
      expect(checkAndRecordFlap(camId, 15 * 60 * 1000, 3)).toBe(true);
    });

    it('cleans up expired flaps outside the window', () => {
      const camId = 'cam-003';
      const now = Date.now();
      // Insert old flap from 20 minutes ago
      cameraFlapHistory.set(camId, [now - 20 * 60 * 1000]);

      // 1 new transition should only bring current window count to 1, not throttled
      expect(checkAndRecordFlap(camId, 15 * 60 * 1000, 3)).toBe(false);
      expect(cameraFlapHistory.get(camId)?.length).toBe(1);
    });
  });

  describe('Root Cause Suggestion', () => {
    it('detects network failure patterns', () => {
      const res = suggestRootCause('connect ETIMEDOUT 192.168.1.100:554');
      expect(res).not.toBeNull();
      expect(res?.rootCause).toBe('network');
    });

    it('detects RTSP/stream failure patterns', () => {
      const res = suggestRootCause('rtsp stream connection terminated unexpectedly');
      expect(res).not.toBeNull();
      expect(res?.rootCause).toBe('rtsp_stream');
    });

    it('detects storage full patterns', () => {
      const res = suggestRootCause('write ENOSPC: no space left on device');
      expect(res).not.toBeNull();
      expect(res?.rootCause).toBe('storage');
    });

    it('returns null for unknown error messages', () => {
      expect(suggestRootCause('random unmapped error')).toBeNull();
    });
  });

  describe('Escalation & Realistic Timing', () => {
    it('computes realistic priority escalation based on configured threshold minutes', () => {
      const highMin = 15;
      const criticalMin = 30;

      // 5 minutes offline -> medium
      expect(computeEscalatedPriority(5 * 60 * 1000, highMin, criticalMin)).toBe('medium');

      // 16 minutes offline -> high
      expect(computeEscalatedPriority(16 * 60 * 1000, highMin, criticalMin)).toBe('high');

      // 35 minutes offline -> critical
      expect(computeEscalatedPriority(35 * 60 * 1000, highMin, criticalMin)).toBe('critical');
    });
  });
});
