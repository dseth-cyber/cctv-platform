/**
 * Live video falls back from WebRTC to HLS when the picture cannot reach the browser over WebRTC.
 *
 * WebRTC carries the picture over UDP straight to the media server's LAN address (MEDIA_WEBRTC_HOST). A browser
 * outside the office that opens the site through the Cloudflare tunnel gets the WHEP answer (HTTP goes through the
 * tunnel) but the UDP never arrives, so the tile stays black. HLS is plain HTTPS and passes the tunnel. The stream
 * token is checked per path, not per protocol, so the WHEP link's own query works for HLS as well.
 */

/** Wait this long for a WebRTC connection before switching a tile to HLS (on the LAN it connects in 1-2 s). */
export const WEBRTC_CONNECT_TIMEOUT_MS = 7_000;

/**
 * `/mediamtx/webrtc/<path>/whep?token=…` -> `/mediamtx/hls/<path>/index.m3u8?token=…`.
 * Null for anything else (a URL we do not know how to translate is not guessed at).
 */
export function whepToHlsUrl(whepUrl: string): string | null {
  if (!whepUrl) return null;
  let path = whepUrl;
  let search = '';
  const q = whepUrl.indexOf('?');
  if (q >= 0) {
    path = whepUrl.slice(0, q);
    search = whepUrl.slice(q);
  }
  const m = /^\/mediamtx\/webrtc\/(.+)\/whep\/?$/.exec(path);
  if (!m) return null;
  return `/mediamtx/hls/${m[1]}/index.m3u8${search}`;
}

/** Can this browser play HLS by itself (Safari, iOS, Android Chrome, recent desktop Chrome/Edge)? */
export function canPlayNativeHls(video: HTMLVideoElement | null): boolean {
  if (!video || typeof video.canPlayType !== 'function') return false;
  return video.canPlayType('application/vnd.apple.mpegurl') !== '' || video.canPlayType('application/x-mpegURL') !== '';
}

/**
 * Once one tile needed HLS on this page, the network does not carry WebRTC: later tiles start on HLS straight
 * away instead of each waiting out the timeout. Reset by reloading the page (e.g. back on the office network).
 */
let webrtcUnreachable = false;
export const liveTransport = {
  markWebrtcUnreachable(): void {
    webrtcUnreachable = true;
  },
  preferHls(): boolean {
    return webrtcUnreachable;
  },
  /** Tests only. */
  reset(): void {
    webrtcUnreachable = false;
  },
};
