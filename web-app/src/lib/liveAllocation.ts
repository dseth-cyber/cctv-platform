export interface LiveAllocationInput {
  /** Every camera in the current view, in display order. */
  cameras: string[];
  /** Cameras on screen, in display order. Only these are offered a free place. */
  visible: string[];
  /** Opened by hand, most recent first. */
  pinned: string[];
  favorites: Set<string>;
  /** What is live now. Scrolling never changes this: an off-screen camera keeps its place. */
  previous: Set<string>;
  /** Cameras that cannot stream right now (offline, no source). A hand-opened one is still tried. */
  unavailable: Set<string>;
  /** Sent back to a still by hand: stays a still, and its place stays free for the next camera picked by hand. */
  released?: Set<string>;
  quota: number;
}

/**
 * Who holds a live place: opened by hand, then already live, then, while places are free, what is on screen
 * with starred ones first. Only a person takes a live camera away, so moving around the page changes nothing.
 * Holding a place is not the same as streaming: see camerasToStream.
 */
export function chooseLiveCameras({ cameras, visible, pinned, favorites, previous, unavailable, released = new Set(), quota }: LiveAllocationInput): Set<string> {
  const inView = new Set(cameras);
  const live = new Set<string>();
  const take = (id: string) => {
    if (live.size < quota) live.add(id);
  };
  pinned.filter((id) => inView.has(id)).forEach(take);
  cameras.filter((id) => previous.has(id) && !unavailable.has(id) && !released.has(id)).forEach(take);
  if (cameras.some((id) => released.has(id))) return live;

  const available = visible.filter((id) => !unavailable.has(id));
  available.filter((id) => favorites.has(id)).forEach(take);
  available.forEach(take);
  return live;
}

/** Off-screen tiles and hidden tabs hold their place but use no stream. */
export function camerasToStream(live: Set<string>, visible: string[], pageVisible: boolean): string[] {
  return pageVisible ? visible.filter((id) => live.has(id)) : [];
}
