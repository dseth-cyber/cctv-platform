export interface LiveAllocationInput {
  /** Cameras on screen, in display order. Off-screen tiles never stream. */
  visible: string[];
  /** Opened by hand, most recent first. */
  pinned: string[];
  favorites: Set<string>;
  /** What is live now: kept where possible so tiles do not swap back and forth while scrolling. */
  previous: Set<string>;
  /** Cameras that cannot stream right now (offline, no source). A hand-opened one is still tried. */
  unavailable: Set<string>;
  /** Sent back to a still by hand: stays a still, and its place stays free for the next camera picked by hand. */
  released?: Set<string>;
  quota: number;
}

/**
 * Who gets live video: opened by hand, then already live, then starred, then the rest on screen.
 * Only a person takes a live camera away. Starring one, or opening one, never pushes another out.
 */
export function chooseLiveCameras({ visible, pinned, favorites, previous, unavailable, released = new Set(), quota }: LiveAllocationInput): Set<string> {
  const onScreen = new Set(visible);
  const live = new Set<string>();
  pinned.filter((id) => onScreen.has(id)).forEach((id) => {
    if (live.size < quota) live.add(id);
  });
  const freedByHand = visible.filter((id) => released.has(id)).length;
  const stillFree = Math.max(0, freedByHand - live.size);
  const limit = quota - stillFree;
  const take = (id: string) => {
    if (live.size < limit) live.add(id);
  };
  const available = visible.filter((id) => !unavailable.has(id) && !released.has(id));
  available.filter((id) => previous.has(id)).forEach(take);
  available.filter((id) => favorites.has(id)).forEach(take);
  available.forEach(take);
  return live;
}
