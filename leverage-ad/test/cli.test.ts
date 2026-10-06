import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { SAMPLE_BRIEF } from '../shared/contract';
import { engineInstalled, findBrowser, probeVideo } from '../src/engine';
import { parseArgs } from '../src/cli';

const CLI = path.resolve(import.meta.dir, '..', 'src', 'cli.ts');
let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leverage-ad-test-'));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bun', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmp, ...env },
    timeout: 60_000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function writeBrief(name: string, brief: unknown): string {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, JSON.stringify(brief));
  return file;
}

describe('parseArgs', () => {
  test('boolean flags never swallow the next positional', () => {
    const f = parseArgs(['--json', 'brief.json']);
    expect(f.bools.has('json')).toBe(true);
    expect(f.positional).toEqual(['brief.json']);
  });

  test('value flags accept both --k v and --k=v', () => {
    expect(parseArgs(['--formats', '9:16', 'b.json']).values.formats).toBe('9:16');
    expect(parseArgs(['--formats=1:1', 'b.json']).values.formats).toBe('1:1');
  });

  test('unknown flags and valueless value-flags throw', () => {
    expect(() => parseArgs(['--nope'])).toThrow('unknown flag');
    expect(() => parseArgs(['--out'])).toThrow('needs a value');
  });
});

describe('leverage-ad CLI (no engine needed)', () => {
  test('init-brief writes a valid brief to stdout path and refuses to overwrite', () => {
    const file = path.join(tmp, 'init', 'brief.json');
    const a = run(['init-brief', file]);
    expect(a.code).toBe(0);
    expect(a.out.trim()).toBe(file);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).slug).toBe(SAMPLE_BRIEF.slug);
    const b = run(['init-brief', file]);
    expect(b.code).toBe(1);
    expect(b.err).toContain('already exists');
  });

  test('validate: ok brief exits 0; invalid brief exits 1 and lists every problem', () => {
    const ok = run(['validate', writeBrief('ok.json', SAMPLE_BRIEF), '--json']);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ ok: true });

    const bad = run(['validate', writeBrief('bad.json', { ...SAMPLE_BRIEF, slug: 'NOPE', scenes: [] })]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('slug');
    expect(bad.err).toContain('scenes');
  });

  test('plan --json prints the resolved storyboard', () => {
    const r = run(['plan', writeBrief('plan.json', SAMPLE_BRIEF), '--json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out) as { storyboard: { totalFrames: number; scenes: unknown[] } };
    expect(j.storyboard.scenes.length).toBe(SAMPLE_BRIEF.scenes.length);
    expect(j.storyboard.totalFrames).toBeGreaterThan(0);
  });

  test('usage errors exit 1: no args, unknown command, missing brief, unknown flag', () => {
    expect(run([]).code).toBe(1);
    expect(run(['bogus']).code).toBe(1);
    expect(run(['validate']).code).toBe(1);
    expect(run(['validate', 'x.json', '--wat']).code).toBe(1);
    expect(run(['validate', path.join(tmp, 'missing.json')]).code).toBe(1);
  });

  test('render: a missing image asset fails fast with exit 1 — before the engine is consulted', () => {
    const scenes = [{ kind: 'image', src: 'nope.png' }, { kind: 'cta', text: 'Go' }];
    const r = run(['render', writeBrief('noimg.json', { ...SAMPLE_BRIEF, scenes })]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('image "nope.png" not found');
  });

  test('render: unknown --formats value is a usage error', () => {
    const r = run(['render', writeBrief('fmt.json', SAMPLE_BRIEF), '--formats', '21:9']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown format');
  });

  test('render: a user brand file overrides the placeholder and is validated', () => {
    const brandFile = path.join(tmp, 'brand-bad.json');
    fs.writeFileSync(brandFile, JSON.stringify({ name: 'X' }));
    const r = run(['render', writeBrief('brief-for-brand-test.json', SAMPLE_BRIEF), '--brand', brandFile]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('invalid brand');
  });

  test('doctor reports engine, browser, brand and the Remotion license notice', () => {
    const r = run(['doctor']);
    expect([0, 3]).toContain(r.code);
    expect(r.err).toContain('engine:');
    expect(r.err).toContain('brand:');
    expect(r.err).toContain('teams of 4+ need a Company License');
  });
});

// Real render: opt-in (LEVERAGE_AD_E2E=1) and only when the engine + a browser are available.
const canRender = process.env.LEVERAGE_AD_E2E === '1' && engineInstalled() && !!findBrowser();
describe.skipIf(!canRender)('leverage-ad render (real Remotion, opt-in)', () => {
  test('renders a verified 1:1 mp4 + poster whose size and duration match the plan', () => {
    const briefFile = writeBrief('e2e.json', { ...SAMPLE_BRIEF, slug: 'e2e', formats: ['1:1'] });
    const plan = JSON.parse(run(['plan', briefFile, '--json']).out) as { seconds: number };
    const r = run(['render', briefFile]);
    expect({ code: r.code, err: r.err }).toMatchObject({ code: 0 });
    const [video, poster] = r.out.trim().split('\n');
    expect(video.endsWith('e2e-1x1.mp4')).toBe(true);
    expect(fs.existsSync(poster)).toBe(true);
    const info = probeVideo(video);
    expect(info?.width).toBe(1080);
    expect(info?.height).toBe(1080);
    expect(Math.abs((info?.durationSec ?? 0) - plan.seconds)).toBeLessThan(0.6);
    const report = JSON.parse(fs.readFileSync(path.join(path.dirname(video), 'render-report.json'), 'utf8'));
    expect(report.outputs[0].format).toBe('1:1');
  }, 240_000);
});
