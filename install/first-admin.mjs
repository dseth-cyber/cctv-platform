// Run once after the first install, inside the API container (it talks to the API on 127.0.0.1:3001):
//   docker exec -i -e ADMIN_NEW_PASSWORD=... cctv-api node --input-type=module - < install/first-admin.mjs
// 1) signs in with the sample admin account the database starts with and sets the new password;
// 2) switches off the sample operator and viewer accounts (their passwords are public in the source).
// Prints only what it did, never a password. Exit 0 = done (or already done), 1 = failed.
const API = 'http://127.0.0.1:3001/api/v1';
const NEW = process.env.ADMIN_NEW_PASSWORD ?? '';
if (NEW.length < 10) { console.error('ADMIN_NEW_PASSWORD must be at least 10 characters'); process.exit(1); }

async function call(method, path, body, token) {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}
const tokenOf = (r) => (r.json?.data ?? r.json)?.accessToken;

let token = tokenOf(await call('POST', '/auth/login', { username: 'admin', password: 'admin123' }));
if (!token) {
  // Already changed (installer run again): check the new password works instead.
  token = tokenOf(await call('POST', '/auth/login', { username: 'admin', password: NEW }));
  if (!token) { console.error('Cannot sign in as admin with the sample or the new password'); process.exit(1); }
  console.log('admin password was already set');
} else {
  const ch = await call('POST', '/auth/change-password', { currentPassword: 'admin123', newPassword: NEW }, token);
  if (ch.status >= 300) { console.error(`Could not set the admin password (HTTP ${ch.status}): ${ch.json?.message ?? ''}`); process.exit(1); }
  console.log('admin password set');
  token = tokenOf(await call('POST', '/auth/login', { username: 'admin', password: NEW }));
  if (!token) { console.error('The new admin password does not sign in'); process.exit(1); }
}

const users = await call('GET', '/users?limit=100', null, token);
for (const u of (users.json?.data ?? [])) {
  if (!['operator', 'viewer'].includes(u.username) || u.enabled === false) continue;
  const r = await call('PATCH', `/users/${u.id}`, { enabled: false }, token);
  console.log(r.status < 300 ? `sample account '${u.username}' switched off` : `could not switch off '${u.username}' (HTTP ${r.status})`);
}
