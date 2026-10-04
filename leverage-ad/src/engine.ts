/**
 * Engine plumbing for /leverage-ad: locate/install the Remotion project,
 * find a browser, spawn the Remotion CLI. Node builtins only.
 *
 * Remotion is source-available (free for individuals and teams of up to 3;
 * 4+ people need a company license), so it is NEVER a root dependency of
 * gstack (MIT) — `leverage-ad setup` installs it on demand into
 * leverage-ad/remotion/node_modules (gitignored).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeReceipt } from '../../lib/egress-receipt';

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE_DIR = path.join(SKILL_ROOT, 'remotion');
export const ENTRY = path.join('src', 'index.ts');

export const LICENSE_NOTICE =
  'Remotion license: free for individuals and teams of up to 3 people; teams of 4+ need a Company License (https://www.remotion.pro). ' +
  'Remotion sends render telemetry used for license accountability.';

export function engineInstalled(): boolean {
  return fs.existsSync(path.join(ENGINE_DIR, 'node_modules', '@remotion', 'cli', 'package.json'));
}

/** Path to the Remotion CLI's JS entry, resolved from its package.json `bin`. */
function remotionCliJs(): string | undefined {
  const pkgPath = path.join(ENGINE_DIR, 'node_modules', '@remotion', 'cli', 'package.json');
  if (!fs.existsSync(pkgPath)) return undefined;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { bin?: string | Record<string, string> };
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.remotion;
  return rel ? path.join(path.dirname(pkgPath), rel) : undefined;
}

/** Prefer real node for the Remotion CLI; fall back to the current runtime. */
function nodeBin(): string {
  const probe = spawnSync('node', ['-v'], { encoding: 'utf8' });
  return probe.status === 0 ? 'node' : process.execPath;
}

export interface Browser {
  path: string;
  /** Remotion's default is the standalone headless shell; a desktop Chrome needs chrome-for-testing mode. */
  mode: 'headless-shell' | 'chrome-for-testing';
}

const isFile = (p: string): boolean => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

/** Prefer a standalone headless shell (what Remotion drives by default); fall back to desktop Chrome. */
export function findBrowser(env: NodeJS.ProcessEnv = process.env): Browser | undefined {
  const asBrowser = (p: string): Browser => ({
    path: p,
    mode: /headless[_-]shell/i.test(path.basename(p)) ? 'headless-shell' : 'chrome-for-testing',
  });
  if (env.LEVERAGE_AD_BROWSER && isFile(env.LEVERAGE_AD_BROWSER)) return asBrowser(env.LEVERAGE_AD_BROWSER);

  const pw = env.PLAYWRIGHT_BROWSERS_PATH;
  if (pw && fs.existsSync(pw)) {
    const dirs = fs.readdirSync(pw).sort().reverse();
    for (const d of dirs.filter((n) => n.startsWith('chromium_headless_shell'))) {
      for (const sub of ['chrome-linux', 'chrome-linux64']) {
        const p = path.join(pw, d, sub, 'headless_shell');
        if (isFile(p)) return asBrowser(p);
      }
    }
  }
  const desktop = [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find(isFile);
  return desktop ? asBrowser(desktop) : undefined;
}

export function browserArgs(b: Browser | undefined): string[] {
  if (!b) return [];
  return [`--browser-executable=${b.path}`, ...(b.mode === 'chrome-for-testing' ? ['--chrome-mode=chrome-for-testing'] : [])];
}

/** Run the Remotion CLI. stdout is routed to stderr so our stdout stays a clean path list. */
export function runRemotion(args: string[], opts: { env?: NodeJS.ProcessEnv } = {}): number {
  const cli = remotionCliJs();
  if (!cli) return 127;
  const r = spawnSync(nodeBin(), [cli, ...args], {
    cwd: ENGINE_DIR,
    stdio: ['ignore', 2, 2],
    env: { ...process.env, ...opts.env },
  });
  return r.status ?? 1;
}

/** Captured Remotion subcommand (e.g. `ffprobe`) — used to verify rendered files. */
export function captureRemotion(args: string[]): { status: number; stdout: string } {
  const cli = remotionCliJs();
  if (!cli) return { status: 127, stdout: '' };
  const r = spawnSync(nodeBin(), [cli, ...args], { cwd: ENGINE_DIR, encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

export interface MediaInfo { width: number; height: number; durationSec: number; hasAudio: boolean }

export function probeVideo(file: string): MediaInfo | undefined {
  const r = captureRemotion([
    'ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-of', 'json', file,
  ]);
  if (r.status !== 0) return undefined;
  try {
    const j = JSON.parse(r.stdout) as { streams?: { codec_type: string; width?: number; height?: number; duration?: string }[] };
    const v = j.streams?.find((s) => s.codec_type === 'video');
    if (!v?.width || !v.height) return undefined;
    return {
      width: v.width,
      height: v.height,
      durationSec: Math.round(parseFloat(v.duration ?? '0') * 10) / 10,
      hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio'),
    };
  } catch {
    return undefined;
  }
}

/** Extract `count` evenly spaced frames (PNG) from a video into `outDir`; returns the written paths. */
export function extractFrames(video: string, outDir: string, count: number): string[] {
  const info = probeVideo(video);
  if (!info || info.durationSec <= 0) return [];
  fs.mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) / count) * info.durationSec;
    const out = path.join(outDir, `frame-${String(i + 1).padStart(2, '0')}.png`);
    const r = captureRemotion(['ffmpeg', '-y', '-v', 'error', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', out]);
    if (r.status === 0 && fs.existsSync(out)) written.push(out);
  }
  return written;
}

/** Fail-open egress receipt: a failed write warns but never blocks a user-invoked install. */
export function receipt(host: string, payloadClass: string, consent: string): void {
  try {
    writeReceipt({ sink: 'leverage-ad-engine', host, payloadClass, consent });
  } catch (e) {
    process.stderr.write(`warning: egress receipt not written (${(e as Error).message}); continuing\n`);
  }
}

export function installEngine(): number {
  process.stderr.write(`${LICENSE_NOTICE}\n`);
  receipt('registry.npmjs.org', 'package-install-metadata', 'user-invoked: leverage-ad setup');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: ENGINE_DIR,
    stdio: ['ignore', 2, 2],
    shell: process.platform === 'win32',
  });
  return r.status ?? 1;
}

export function defaultBrandPath(): string {
  return path.join(SKILL_ROOT, 'brand', 'leverageai.default.json');
}

export function userBrandPath(home: string = os.homedir()): string {
  return path.join(home, '.gstack', 'leverage-ad', 'brand.json');
}
