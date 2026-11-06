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
  quota: number;
}

/** Who gets live video: opened by hand, then starred, then already live, then the rest on screen. */
export function chooseLiveCameras({ visible, pinned, favorites, previous, unavailable, quota }: LiveAllocationInput): Set<string> {
  const onScreen = new Set(visible);
  const live = new Set<string>();
  const take = (id: string) => {
    if (live.size < quota) live.add(id);
  };
  pinned.filter((id) => onScreen.has(id)).forEach(take);
  const available = visible.filter((id) => !unavailable.has(id));
  available.filter((id) => favorites.has(id)).forEach(take);
  available.filter((id) => previous.has(id)).forEach(take);
  available.forEach(take);
  return live;
}
