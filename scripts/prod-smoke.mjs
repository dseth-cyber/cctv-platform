// After a deploy: is the system really up and serving? Read only (it watches one camera's live sub stream
// for a moment, like a person opening live view). Never prints a password or token.
//
//   SMOKE_USER=<admin user> SMOKE_PASSWORD=<their password> node scripts/prod-smoke.mjs [https://127.0.0.1:8443]
//
// Exit 0 = all checks passed. Runbook: docs/ops/DEPLOY_PRODUCTION.md
process.env.NODE_TLS_REJECT_UNAUTHORIZED ??= '0'; // the server's own certificate may be self-signed

const BASE = (process.argv[2] ?? process.env.SMOKE_BASE ?? 'https://127.0.0.1:8443').replace(/\/$/, '');
const API = `${BASE}/image-service/api/v1`;
const EXPECT_ENV = process.env.SMOKE_EXPECT_ENV ?? 'production';
let failed = 0;
let warned = 0;
const check = (name, ok, extra = '') => { if (!ok) failed += 1; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`); return ok; };
const warn = (name, extra = '') => { warned += 1; console.log(`WARN ${name}${extra ? `  (${extra})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (path, token) => {
  const r = await fetch(path.startsWith('http') ? path : `${API}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
};
const login = async (username, password) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? (j.data ?? j).accessToken : null;
};
const list = (j) => (Array.isArray(j) ? j : j?.items ?? j?.data ?? []);

console.log(`CCTV smoke test against ${BASE} (${new Date().toISOString()})`);
try {
  const web = await get(BASE + '/');
  check('web app serves the page', web.status === 200 && /<title>/i.test(web.text), `HTTP ${web.status}`);

  const ready = await get('/health/ready');
  const checks = ready.json?.checks ?? {};
  check('API ready: database, redis, storage', ready.status === 200 && Object.values(checks).every((v) => v === 'ok'), JSON.stringify(checks));

  const user = process.env.SMOKE_USER;
  const pass = process.env.SMOKE_PASSWORD;
  if (!user || !pass) throw new Error('set SMOKE_USER and SMOKE_PASSWORD (an admin account) in the environment');
  const token = await login(user, pass);
  if (!check('admin sign-in', !!token)) throw new Error('cannot sign in; the remaining checks need it');

  const pre = (await get('/release/preflight', token)).json ?? {};
  check(`installation says "${EXPECT_ENV}"`, pre.environment === EXPECT_ENV, `environment=${pre.environment}`);
  check('isolation from legacy production confirmed', pre.isolationVerified === true);
  const blocking = (pre.items ?? []).filter((i) => i.status === 'failed' && i.category !== 'acceptance').map((i) => i.name);
  check('release centre: no failed checks (pilot sign-off aside)', blocking.length === 0, blocking.join(', ') || `score ${pre.score}%`);

  const nodes = list((await get('/media-nodes', token)).json);
  const node = nodes.find((n) => n.isDefault) ?? nodes[0];
  check('media server (MediaMTX) online', node?.status === 'online', node ? `${node.name}: ${node.status}` : 'none');

  const devices = list((await get('/devices?limit=500', token)).json);
  const reachable = devices.filter((d) => d.healthInfo?.reachable);
  const loginFailed = devices.filter((d) => d.healthInfo?.loginFailed).map((d) => d.name);
  const unchecked = devices.filter((d) => !d.healthCheckedAt).map((d) => d.name);
  check('recorders present', devices.length > 0, `${devices.length}`);
  if (devices.length) check('recorders reachable', reachable.length === devices.length, `${reachable.length}/${devices.length} reachable`);
  if (loginFailed.length) warn('recorders refusing the stored password (enter it in Devices > edit)', loginFailed.join(', '));
  if (unchecked.length) warn('recorders not health-checked yet (wait for the first round, a few minutes)', unchecked.join(', '));

  const cameras = list((await get('/cameras?limit=1000', token)).json);
  const enabled = cameras.filter((c) => c.enabled);
  check('cameras present', enabled.length > 0, `${enabled.length} enabled of ${cameras.length}`);

  // One camera on a reachable recorder: ask for its stream and read the live playlist (the sub stream).
  const reachableIds = new Set(reachable.map((d) => d.id));
  const cam = enabled.find((c) => reachableIds.has(c.deviceId) && c.rtspUrlSub) ?? enabled.find((c) => reachableIds.has(c.deviceId));
  if (!cam) warn('no camera on a reachable recorder to test live video');
  else {
    const s = await get(`/cameras/${cam.id}/stream?profile=sub`, token);
    if (check(`live stream granted for "${cam.name}"`, s.status === 200 && !!s.json?.hlsUrl, `HTTP ${s.status}`)) {
      const u = new URL(s.json.hlsUrl, BASE);
      // MediaMTX first answers with a cookie-check redirect (to a path without our /mediamtx/hls prefix), so send
      // the cookie and the flag ourselves instead of following it.
      u.searchParams.set('cookieCheck', '1');
      const hls = `${BASE}/mediamtx/hls${u.pathname}${u.search}`;
      let playlist = null;
      for (let i = 0; i < 20 && !playlist; i++) {
        const r = await fetch(hls, { headers: { cookie: 'cookieCheck=1' }, redirect: 'manual' });
        const text = await r.text();
        if (r.status === 200 && /#EXTM3U/.test(text)) playlist = text;
        else await sleep(1000);
      }
      check(`live video arrives from the recorder ("${cam.name}")`, !!playlist, playlist ? 'playlist ok' : 'no playlist within 20 s');
    }
  }

  // The seeded passwords must have been changed. One try each; a wrong password is one normal failed sign-in.
  for (const [u, p] of [['admin', 'admin123'], ['operator', 'operator123'], ['viewer', 'viewer123']]) {
    const t = await login(u, p);
    check(`default password of "${u}" no longer works`, !t);
  }
} catch (err) {
  check('smoke test ran to the end', false, err instanceof Error ? err.message : String(err));
}
console.log(failed ? `${failed} FAILED, ${warned} WARN` : `all passed, ${warned} WARN`);
process.exit(failed ? 1 : 0);
