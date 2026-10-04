import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import {
  FORMATS,
  FORMAT_IDS,
  FPS,
  GUIDANCE,
  LIMITS,
  SAMPLE_BRIEF,
  SCENE_KINDS,
  TRANSITION_FRAMES,
  defaultSceneSeconds,
  resolveStoryboard,
  totalSeconds,
  validateBrand,
  validateBrief,
  type AdBrief,
  type Scene,
} from '../shared/contract';

const ROOT = path.resolve(import.meta.dir, '..');

const brief = (over: Record<string, unknown> = {}): unknown => ({ ...SAMPLE_BRIEF, ...over });
const errorsOf = (raw: unknown): string[] => {
  const r = validateBrief(raw);
  if (r.ok) throw new Error('expected validation to fail');
  return r.errors;
};

describe('validateBrief', () => {
  test('the sample brief is valid and warning-free', () => {
    const r = validateBrief(SAMPLE_BRIEF);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  test('rejects bad slugs', () => {
    for (const slug of ['', 'Has Caps', 'under_score', '-leading', 'x'.repeat(41)]) {
      expect(errorsOf(brief({ slug })).join('\n')).toContain('slug');
    }
  });

  test('the last scene must be a cta, and a cta may not appear earlier', () => {
    const noCta = SAMPLE_BRIEF.scenes.slice(0, -1);
    expect(errorsOf(brief({ scenes: noCta })).join('\n')).toContain('last scene must be kind "cta"');
    const cta: Scene = { kind: 'cta', text: 'Go' };
    const early = [cta, ...SAMPLE_BRIEF.scenes];
    expect(errorsOf(brief({ scenes: early })).join('\n')).toContain('only allowed as the last scene');
  });

  test('enforces per-field length limits', () => {
    const long = 'x'.repeat(LIMITS.headline + 1);
    const scenes = [{ kind: 'title', headline: long }, ...SAMPLE_BRIEF.scenes.slice(1)];
    expect(errorsOf(brief({ scenes })).join('\n')).toContain('scenes[0].headline');
  });

  test('bullets need 2-5 items', () => {
    const mk = (items: string[]) => [{ kind: 'bullets', items }, { kind: 'cta', text: 'Go' }];
    expect(errorsOf(brief({ scenes: mk(['one']) })).join('\n')).toContain('needs 2-5 items');
    expect(errorsOf(brief({ scenes: mk(['1', '2', '3', '4', '5', '6']) })).join('\n')).toContain('needs 2-5 items');
    expect(validateBrief(brief({ scenes: mk(['a', 'b']) })).ok).toBe(true);
  });

  test('remote asset URLs are refused (renders stay offline)', () => {
    const scenes = [{ kind: 'image', src: 'https://example.com/a.png' }, { kind: 'cta', text: 'Go' }];
    expect(errorsOf(brief({ scenes })).join('\n')).toContain('remote URLs are not supported');
    expect(errorsOf(brief({ audio: { music: 'http://x/y.mp3' } })).join('\n')).toContain('audio.music');
  });

  test('rejects unknown scene kinds, formats and out-of-range numbers', () => {
    expect(errorsOf(brief({ scenes: [{ kind: 'carousel' }, { kind: 'cta', text: 'Go' }] })).join('\n')).toContain('scenes[0].kind');
    expect(errorsOf(brief({ formats: ['21:9'] })).join('\n')).toContain('formats: unknown 21:9');
    expect(errorsOf(brief({ audio: { musicVolume: 2 } })).join('\n')).toContain('audio.musicVolume');
    const slow = [{ kind: 'title', headline: 'Hi', durationSec: 99 }, { kind: 'cta', text: 'Go' }];
    expect(errorsOf(brief({ scenes: slow })).join('\n')).toContain('durationSec');
  });

  test('reports every error at once, not just the first', () => {
    const errs = errorsOf({ slug: 'BAD', scenes: 'nope' });
    expect(errs.length).toBeGreaterThanOrEqual(4);
  });

  test('guidance surfaces as warnings, never errors', () => {
    const slowHook = [{ kind: 'title', headline: 'Hi', durationSec: GUIDANCE.hookMaxSec + 1 }, { kind: 'cta', text: 'Go' }];
    const r1 = validateBrief(brief({ scenes: slowHook }));
    expect(r1.ok && r1.warnings.some((w) => w.startsWith('hook:'))).toBe(true);

    const longAd = [
      ...Array.from({ length: 5 }, () => ({ kind: 'statement', text: 'Word', durationSec: 8 })),
      { kind: 'cta', text: 'Go' },
    ];
    const r2 = validateBrief(brief({ scenes: longAd }));
    expect(r2.ok && r2.warnings.some((w) => w.startsWith('length:'))).toBe(true);
  });
});

describe('storyboard timing', () => {
  test('default duration scales with reading time, floored and capped', () => {
    const short: Scene = { kind: 'statement', text: 'Hi' };
    const huge: Scene = { kind: 'statement', text: Array(120).fill('word').join(' ') };
    expect(defaultSceneSeconds(short)).toBe(2.5);
    expect(defaultSceneSeconds(huge)).toBe(8);
    const mid: Scene = { kind: 'statement', text: Array(14).fill('word').join(' ') };
    expect(defaultSceneSeconds(mid)).toBeGreaterThan(defaultSceneSeconds(short));
  });

  test('total frames = sum of scenes minus one overlap per transition', () => {
    const sb = resolveStoryboard(SAMPLE_BRIEF);
    const sum = sb.scenes.reduce((n, s) => n + s.frames, 0);
    expect(sb.totalFrames).toBe(sum - (sb.scenes.length - 1) * TRANSITION_FRAMES);
    expect(sb.scenes[0].startFrame).toBe(0);
  });

  test('scene windows are contiguous: each starts TRANSITION_FRAMES before the previous ends', () => {
    const sb = resolveStoryboard(SAMPLE_BRIEF);
    for (let i = 1; i < sb.scenes.length; i++) {
      const prev = sb.scenes[i - 1];
      expect(sb.scenes[i].startFrame).toBe(prev.startFrame + prev.frames - TRANSITION_FRAMES);
    }
  });

  test('even the shortest legal scene outlasts two transitions', () => {
    expect(Math.round(LIMITS.durationSec.min * FPS)).toBeGreaterThan(2 * TRANSITION_FRAMES);
  });

  test('durationSec overrides the computed default', () => {
    const b: AdBrief = { ...SAMPLE_BRIEF, scenes: [{ kind: 'title', headline: 'Hi', durationSec: 5 }, { kind: 'cta', text: 'Go', durationSec: 4 }] };
    const sb = resolveStoryboard(b);
    expect(sb.scenes[0].frames).toBe(5 * FPS);
    expect(totalSeconds(sb)).toBeCloseTo((9 * FPS - TRANSITION_FRAMES) / FPS, 1);
  });
});

describe('formats', () => {
  test('every format id has a unique comp id and the right aspect ratio', () => {
    const ids = new Set<string>();
    for (const id of FORMAT_IDS) {
      const f = FORMATS[id];
      expect(ids.has(f.compId)).toBe(false);
      ids.add(f.compId);
      const [w, h] = id.split(':').map(Number);
      expect(Math.abs(f.width / f.height - w / h)).toBeLessThan(0.001);
      expect(f.compId).toBe(`Ad-${w}x${h}`);
    }
  });
});

describe('validateBrand', () => {
  const read = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

  test('the shipped default brand is valid and flagged as a placeholder', () => {
    const r = validateBrand(read('brand/leverageai.default.json'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.placeholder).toBe(true);
  });

  test('rejects non-hex colors and missing fonts', () => {
    const bad = read('brand/leverageai.default.json');
    bad.colors.accent = 'blue';
    delete bad.fonts;
    const r = validateBrand(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join('\n')).toContain('brand.colors.accent');
      expect(r.errors.join('\n')).toContain('brand.fonts');
    }
  });
});

describe('engine wiring tripwires', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'remotion', 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };

  test('all remotion packages are pinned to one exact version (Remotion requires lockstep)', () => {
    const versions = Object.entries(pkg.dependencies)
      .filter(([name]) => name === 'remotion' || name.startsWith('@remotion/'))
      .map(([, v]) => v);
    expect(versions.length).toBeGreaterThan(1);
    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('remotion is never a dependency of the gstack root (license: source-available, not MIT)', () => {
    const root = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = Object.keys({ ...root.dependencies, ...root.devDependencies });
    expect(all.filter((n) => n === 'remotion' || n.startsWith('@remotion/'))).toEqual([]);
  });

  test('every scene kind has a renderer in the engine', () => {
    const scenes = fs.readFileSync(path.join(ROOT, 'remotion', 'src', 'scenes.tsx'), 'utf8');
    const ad = fs.readFileSync(path.join(ROOT, 'remotion', 'src', 'Ad.tsx'), 'utf8');
    for (const kind of SCENE_KINDS) {
      const comp = `${kind[0].toUpperCase()}${kind.slice(1)}Scene`;
      expect(scenes).toContain(`export const ${comp}`);
      expect(ad).toContain(`case '${kind}'`);
    }
  });
});
