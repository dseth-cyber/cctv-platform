import { execFile } from 'node:child_process';

interface SmbEntry {
  name: string;
  isDirectory: boolean;
}

export async function testConnection(params: {
  smbSharePath: string;
  smbUsername: string;
  smbPasswordEncrypted: string;
  smbDomain?: string;
}): Promise<{ success: boolean; message: string; code?: string }> {
  const { host, share } = parseSmbPath(params.smbSharePath);
  const unc = `//${host}/${share}`;
  const creds = `${params.smbUsername}%${params.smbPasswordEncrypted}`;
  const args = [unc, '-U', creds, '-c', 'ls'];
  if (params.smbDomain) args.push('-W', params.smbDomain);

  try {
    await runSmbClient(args);
    return { success: true, message: `Connected to ${unc}` };
  } catch (err: any) {
    const { code, detail } = classifySmbError(err.message);
    return { success: false, message: detail, code };
  }
}

function classifySmbError(detail: string): { code: string; detail: string } {
  const s = detail.toLowerCase();
  if (s.includes('nt_status_logon_failure') || s.includes('nt_status_wrong_password') || s.includes('nt_status_access_denied')) {
    return { code: 'auth_failed', detail };
  }
  if (s.includes('nt_status_bad_network_name')) {
    return { code: 'share_not_found', detail };
  }
  if (s.includes('nt_status_object_name_not_found') || s.includes('nt_status_object_path_not_found')) {
    return { code: 'path_not_found', detail };
  }
  if (s.includes('nt_status_host_unreachable') || s.includes('nt_status_io_timeout') || s.includes('connection timed out') || s.includes('timeout') || s.includes('connection refused')) {
    return { code: 'unreachable', detail };
  }
  return { code: 'unknown', detail: detail || 'smbclient command failed' };
}

export async function listShares(params: {
  host: string;
  smbUsername: string;
  smbPasswordEncrypted: string;
  smbDomain?: string;
}): Promise<{ shares: Array<{ name: string; description: string }> }> {
  const creds = `${params.smbUsername}%${params.smbPasswordEncrypted}`;
  const args = ['-L', `//${params.host}`, '-U', creds];
  if (params.smbDomain) args.push('-W', params.smbDomain);

  const stdout = await runSmbClient(args);
  const shares: Array<{ name: string; description: string }> = [];

  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s{0,}(\S+)\s{2,}(Disk|disk|Printer|printer|IPC)\s{0,}(.*)$/);
    if (m && m[2].toLowerCase() === 'disk') {
      shares.push({ name: m[1], description: m[3].trim() });
    }
  }

  return { shares };
}

export async function browseDirectory(params: {
  smbSharePath: string;
  smbUsername: string;
  smbPasswordEncrypted: string;
  smbDomain?: string;
  path?: string;
}): Promise<{ entries: SmbEntry[]; currentPath: string }> {
  const { host, share } = parseSmbPath(params.smbSharePath);
  const unc = `//${host}/${share}`;
  const creds = `${params.smbUsername}%${params.smbPasswordEncrypted}`;
  const lsPath = params.path ? params.path.replace(/\\/g, '/').replace(/\/$/, '') : '';
  const args = [unc, '-U', creds, '-c', lsPath ? `ls "${lsPath}"` : 'ls'];
  if (params.smbDomain) args.push('-W', params.smbDomain);

  const stdout = await runSmbClient(args);
  const entries: SmbEntry[] = [];

  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(.+?)\s+([DN])\s+/);
    if (!m) continue;
    const name = m[1].trim();
    if (name === '.' || name === '..') continue;
    entries.push({ name, isDirectory: m[2] === 'D' });
  }

  return { entries, currentPath: params.path ?? '' };
}

function parseSmbPath(smbSharePath: string): { host: string; share: string } {
  const m = smbSharePath.match(/^\/\/([^/]+)\/([^/]+)/);
  if (!m) throw new Error(`Invalid SMB path: "${smbSharePath}"`);
  return { host: m[1], share: m[2] };
}

function runSmbClient(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Do not surface `err.message` here: Node's execFile embeds the full argv
    // (including the "-U user%password" credential string) in that message on
    // non-zero exit. smbclient prints its own error text (e.g. "session setup
    // failed: NT_STATUS_LOGON_FAILURE") to stdout rather than stderr, and never
    // echoes the args itself, so stdout/stderr content is safe to propagate.
    execFile('smbclient', args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || '').trim() || (stdout || '').trim();
        reject(new Error(detail || `smbclient exited with code ${(err as any).code ?? 'unknown'}`));
        return;
      }
      resolve(stdout);
    });
  });
}
