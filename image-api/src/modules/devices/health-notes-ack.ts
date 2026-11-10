/**
 * Recorder notes a person can acknowledge when the recorder cannot (or should not) be changed: a model that always
 * records the sub stream too, or H.265+ left on on purpose. An acknowledged note is shown greyed instead of as a
 * warning. It is dropped by itself once the recorder no longer shows the condition, so if it comes back later it is
 * a warning again.
 */
export const ACK_NOTES = ['sub_recording', 'smart_codec'] as const;
export type AckNote = (typeof ACK_NOTES)[number];
export type HealthNotesAck = Partial<Record<AckNote, { by: string; at: string }>>;

/** Which notes the recorder shows now; null means not read this round (keep any acknowledgement). */
export function notesShown(health: { subRecordingChannels?: number[] | null; smartCodecChannels?: number[] | null }): Record<AckNote, boolean | null> {
  const shown = (v: number[] | null | undefined) => (v === null || v === undefined ? null : v.length > 0);
  return { sub_recording: shown(health.subRecordingChannels), smart_codec: shown(health.smartCodecChannels) };
}

/** Acknowledgements that still apply after a reading; returns null when nothing changed. */
export function pruneAck(ack: HealthNotesAck | null | undefined, health: Parameters<typeof notesShown>[0]): HealthNotesAck | null {
  if (!ack) return null;
  const shown = notesShown(health);
  const kept: HealthNotesAck = {};
  let changed = false;
  for (const note of ACK_NOTES) {
    if (!ack[note]) continue;
    if (shown[note] === false) { changed = true; continue; }
    kept[note] = ack[note];
  }
  return changed ? kept : null;
}

export function setAck(ack: HealthNotesAck | null | undefined, note: AckNote, on: boolean, by: string, at = new Date()): HealthNotesAck {
  const next: HealthNotesAck = { ...(ack ?? {}) };
  if (on) next[note] = { by, at: at.toISOString() };
  else delete next[note];
  return next;
}
