/**
 * leverage-ad contract — the single source of truth shared by the CLI
 * (bun) and the Remotion engine (webpack/rspack bundle). Pure TS: no imports,
 * no Node/DOM APIs, so both sides can import it unchanged.
 *
 *   AdBrief (authored) --validateBrief--> AdBrief (checked)
 *   AdBrief --resolveStoryboard--> Storyboard (frames resolved, format-free)
 *   Storyboard + Brand + FormatId --> Remotion composition props
 *
 * Extension points: add a scene kind (SCENE_KINDS + Scene union + validator
 * branch + a component in remotion/src/scenes.tsx), add a format (FORMATS),
 * add a brand token (Brand + validateBrand + scenes).
 */

export const FPS = 30;
/** Cross-fade overlap between consecutive scenes, in frames. */
export const TRANSITION_FRAMES = 12;

export const FORMAT_IDS = ['16:9', '9:16', '1:1', '4:5'] as const;
export type FormatId = (typeof FORMAT_IDS)[number];

export interface FormatSpec {
  width: number;
  height: number;
  /** Remotion composition id; also the filename suffix. */
  compId: string;
  label: string;
  /** Fraction of height reserved at the bottom for platform UI overlays. */
  safeBottom: number;
}

export const FORMATS: Record<FormatId, FormatSpec> = {
  '16:9': { width: 1920, height: 1080, compId: 'Ad-16x9', label: 'YouTube / LinkedIn / site hero', safeBottom: 0.06 },
  '9:16': { width: 1080, height: 1920, compId: 'Ad-9x16', label: 'Reels / Shorts / TikTok / Stories', safeBottom: 0.18 },
  '1:1': { width: 1080, height: 1080, compId: 'Ad-1x1', label: 'LinkedIn / Facebook feed', safeBottom: 0.06 },
  '4:5': { width: 1080, height: 1350, compId: 'Ad-4x5', label: 'Instagram / Facebook feed (tall)', safeBottom: 0.08 },
};

export const DEFAULT_FORMATS: FormatId[] = ['16:9', '9:16'];

export const OBJECTIVES = ['awareness', 'leads', 'demo', 'recruiting', 'announcement'] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const SCENE_KINDS = ['title', 'statement', 'bullets', 'stat', 'image', 'quote', 'cta'] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

interface SceneBase {
  /** Override the computed on-screen time, in seconds. */
  durationSec?: number;
}
export interface TitleScene extends SceneBase { kind: 'title'; headline: string; sub?: string }
export interface StatementScene extends SceneBase { kind: 'statement'; text: string }
export interface BulletsScene extends SceneBase { kind: 'bullets'; heading?: string; items: string[] }
export interface StatScene extends SceneBase { kind: 'stat'; value: string; label: string }
export interface ImageScene extends SceneBase { kind: 'image'; src: string; caption?: string }
export interface QuoteScene extends SceneBase { kind: 'quote'; text: string; attribution: string }
export interface CtaScene extends SceneBase { kind: 'cta'; text: string; url?: string }
export type Scene = TitleScene | StatementScene | BulletsScene | StatScene | ImageScene | QuoteScene | CtaScene;

export interface AdAudio {
  /** Local audio file, path relative to the brief. */
  music?: string;
  /** 0..1, default 0.25 (bed under the visuals). */
  musicVolume?: number;
  /** Local voiceover file, path relative to the brief. Plays at full volume. */
  voiceover?: string;
}

export interface AdBrief {
  /** kebab-case; names the output folder and files. */
  slug: string;
  /** Internal working title (never rendered). */
  title: string;
  objective: Objective;
  audience: string;
  scenes: Scene[];
  formats?: FormatId[];
  audio?: AdAudio;
}

export interface Brand {
  name: string;
  tagline?: string;
  /** Local image path, relative to the brand file. Optional. */
  logo?: string;
  colors: { bg: string; bgAlt: string; fg: string; muted: string; accent: string };
  fonts: { heading: string; body: string };
  /** True for the shipped default — the skill asks for real brand tokens. */
  placeholder?: boolean;
}

export interface ResolvedScene {
  scene: Scene;
  frames: number;
  /** Absolute start frame on the composition timeline (overlaps applied). */
  startFrame: number;
}

export interface Storyboard {
  fps: number;
  scenes: ResolvedScene[];
  totalFrames: number;
}

/** Props handed to every Remotion composition. `src`/audio/logo are staged filenames. */
export type AdProps = {
  storyboard: Storyboard;
  brand: Brand;
  format: FormatId;
  audio: { music?: string; musicVolume: number; voiceover?: string };
  logo?: string;
};

// ---------- limits (the hand-written "constraints" — each is a build-time check) ----------

export const LIMITS = {
  scenes: { min: 2, max: 12 },
  headline: 80,
  sub: 100,
  statement: 140,
  bulletsItems: { min: 2, max: 5 },
  bulletItem: 60,
  statValue: 12,
  statLabel: 60,
  quote: 180,
  attribution: 60,
  caption: 100,
  cta: 60,
  url: 80,
  durationSec: { min: 1.5, max: 12 },
  musicVolume: { min: 0, max: 1 },
} as const;

/** Soft guidance — surfaced as warnings, never errors. */
export const GUIDANCE = {
  hookMaxSec: 3.5,
  adMaxSec: 30,
  verticalMaxSec: 60,
} as const;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const REMOTE_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function sceneText(s: Scene): string[] {
  switch (s.kind) {
    case 'title': return [s.headline, s.sub ?? ''];
    case 'statement': return [s.text];
    case 'bullets': return [s.heading ?? '', ...s.items];
    case 'stat': return [s.value, s.label];
    case 'image': return [s.caption ?? ''];
    case 'quote': return [s.text, s.attribution];
    case 'cta': return [s.text, s.url ?? ''];
  }
}

/** Reading-time-based default: enough time to read the words, floored per kind. */
export function defaultSceneSeconds(s: Scene): number {
  const words = sceneText(s).reduce((n, t) => n + wordCount(t), 0);
  const floor = s.kind === 'title' ? 2.5 : s.kind === 'statement' ? 2.5 : 3;
  const sec = Math.min(8, Math.max(floor, 1.8 + words / 2.8));
  return Math.round(sec * 10) / 10;
}

export function sceneSeconds(s: Scene): number {
  return s.durationSec ?? defaultSceneSeconds(s);
}

export function resolveStoryboard(brief: AdBrief, fps: number = FPS): Storyboard {
  let start = 0;
  const scenes: ResolvedScene[] = brief.scenes.map((scene, i) => {
    const frames = Math.round(sceneSeconds(scene) * fps);
    if (i > 0) start -= TRANSITION_FRAMES;
    const resolved = { scene, frames, startFrame: start };
    start += frames;
    return resolved;
  });
  return { fps, scenes, totalFrames: start };
}

export function totalSeconds(sb: Storyboard): number {
  return Math.round((sb.totalFrames / sb.fps) * 10) / 10;
}

// ---------- validation ----------

function checkStr(
  errors: string[], at: string, v: unknown, max: number, opts: { optional?: boolean } = {},
): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (!opts.optional) errors.push(`${at}: required`);
    return undefined;
  }
  if (typeof v !== 'string') { errors.push(`${at}: must be a string`); return undefined; }
  if (v.length > max) errors.push(`${at}: ${v.length} chars exceeds the ${max}-char limit (it must be readable in seconds — cut words)`);
  return v;
}

function validateScene(raw: unknown, at: string, errors: string[]): Scene | undefined {
  if (!isRecord(raw)) { errors.push(`${at}: must be an object`); return undefined; }
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(SCENE_KINDS as readonly string[]).includes(kind)) {
    errors.push(`${at}.kind: must be one of ${SCENE_KINDS.join(', ')}`);
    return undefined;
  }
  const before = errors.length;
  if (raw.durationSec !== undefined) {
    const d = raw.durationSec;
    if (typeof d !== 'number' || !Number.isFinite(d) || d < LIMITS.durationSec.min || d > LIMITS.durationSec.max) {
      errors.push(`${at}.durationSec: must be a number between ${LIMITS.durationSec.min} and ${LIMITS.durationSec.max}`);
    }
  }
  const durationSec = typeof raw.durationSec === 'number' ? raw.durationSec : undefined;
  let scene: Scene | undefined;
  switch (kind as SceneKind) {
    case 'title': {
      const headline = checkStr(errors, `${at}.headline`, raw.headline, LIMITS.headline);
      const sub = checkStr(errors, `${at}.sub`, raw.sub, LIMITS.sub, { optional: true });
      scene = { kind: 'title', headline: headline ?? '', sub, durationSec };
      break;
    }
    case 'statement': {
      const text = checkStr(errors, `${at}.text`, raw.text, LIMITS.statement);
      scene = { kind: 'statement', text: text ?? '', durationSec };
      break;
    }
    case 'bullets': {
      const heading = checkStr(errors, `${at}.heading`, raw.heading, LIMITS.headline, { optional: true });
      const items: string[] = [];
      if (!Array.isArray(raw.items)) errors.push(`${at}.items: must be an array`);
      else {
        const { min, max } = LIMITS.bulletsItems;
        if (raw.items.length < min || raw.items.length > max) errors.push(`${at}.items: needs ${min}-${max} items (got ${raw.items.length})`);
        raw.items.forEach((it, j) => {
          const s = checkStr(errors, `${at}.items[${j}]`, it, LIMITS.bulletItem);
          if (s !== undefined) items.push(s);
        });
      }
      scene = { kind: 'bullets', heading, items, durationSec };
      break;
    }
    case 'stat': {
      const value = checkStr(errors, `${at}.value`, raw.value, LIMITS.statValue);
      const label = checkStr(errors, `${at}.label`, raw.label, LIMITS.statLabel);
      scene = { kind: 'stat', value: value ?? '', label: label ?? '', durationSec };
      break;
    }
    case 'image': {
      const src = checkStr(errors, `${at}.src`, raw.src, 400);
      if (src && REMOTE_RE.test(src)) errors.push(`${at}.src: remote URLs are not supported — download the asset and use a local path (renders stay offline and reproducible)`);
      const caption = checkStr(errors, `${at}.caption`, raw.caption, LIMITS.caption, { optional: true });
      scene = { kind: 'image', src: src ?? '', caption, durationSec };
      break;
    }
    case 'quote': {
      const text = checkStr(errors, `${at}.text`, raw.text, LIMITS.quote);
      const attribution = checkStr(errors, `${at}.attribution`, raw.attribution, LIMITS.attribution);
      scene = { kind: 'quote', text: text ?? '', attribution: attribution ?? '', durationSec };
      break;
    }
    case 'cta': {
      const text = checkStr(errors, `${at}.text`, raw.text, LIMITS.cta);
      const url = checkStr(errors, `${at}.url`, raw.url, LIMITS.url, { optional: true });
      scene = { kind: 'cta', text: text ?? '', url, durationSec };
      break;
    }
  }
  return errors.length === before ? scene : undefined;
}

export function validateBrief(raw: unknown): ValidationResult<AdBrief> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['brief: must be a JSON object'] };

  if (typeof raw.slug !== 'string' || !SLUG_RE.test(raw.slug)) errors.push('slug: kebab-case, 1-40 chars, [a-z0-9-], must start with a letter or digit');
  const title = checkStr(errors, 'title', raw.title, 120);
  const audience = checkStr(errors, 'audience', raw.audience, 200);
  if (typeof raw.objective !== 'string' || !(OBJECTIVES as readonly string[]).includes(raw.objective)) {
    errors.push(`objective: must be one of ${OBJECTIVES.join(', ')}`);
  }

  let formats: FormatId[] | undefined;
  if (raw.formats !== undefined) {
    if (!Array.isArray(raw.formats) || raw.formats.length === 0) errors.push('formats: must be a non-empty array');
    else {
      const bad = raw.formats.filter((f) => !(FORMAT_IDS as readonly unknown[]).includes(f));
      if (bad.length) errors.push(`formats: unknown ${bad.map(String).join(', ')} (valid: ${FORMAT_IDS.join(', ')})`);
      else formats = [...new Set(raw.formats as FormatId[])];
    }
  }

  let audio: AdAudio | undefined;
  if (raw.audio !== undefined) {
    if (!isRecord(raw.audio)) errors.push('audio: must be an object');
    else {
      const a = raw.audio;
      const music = checkStr(errors, 'audio.music', a.music, 400, { optional: true });
      const voiceover = checkStr(errors, 'audio.voiceover', a.voiceover, 400, { optional: true });
      for (const [k, v] of [['music', music], ['voiceover', voiceover]] as const) {
        if (v && REMOTE_RE.test(v)) errors.push(`audio.${k}: remote URLs are not supported — use a local file`);
      }
      let musicVolume: number | undefined;
      if (a.musicVolume !== undefined) {
        const mv = a.musicVolume;
        if (typeof mv !== 'number' || !(mv >= LIMITS.musicVolume.min && mv <= LIMITS.musicVolume.max)) errors.push('audio.musicVolume: must be a number between 0 and 1');
        else musicVolume = mv;
      }
      audio = { music, voiceover, musicVolume };
    }
  }

  const scenes: Scene[] = [];
  if (!Array.isArray(raw.scenes)) errors.push('scenes: must be an array');
  else {
    const { min, max } = LIMITS.scenes;
    if (raw.scenes.length < min || raw.scenes.length > max) errors.push(`scenes: needs ${min}-${max} scenes (got ${raw.scenes.length})`);
    raw.scenes.forEach((s, i) => {
      const v = validateScene(s, `scenes[${i}]`, errors);
      if (v) scenes.push(v);
    });
    if (scenes.length === raw.scenes.length && scenes.length > 0) {
      if (scenes[scenes.length - 1].kind !== 'cta') errors.push('scenes: the last scene must be kind "cta" — an ad without a call to action is not an ad');
      scenes.slice(0, -1).forEach((s, i) => { if (s.kind === 'cta') errors.push(`scenes[${i}]: "cta" is only allowed as the last scene`); });
    }
  }

  if (errors.length) return { ok: false, errors };

  const brief: AdBrief = {
    slug: raw.slug as string,
    title: title as string,
    objective: raw.objective as Objective,
    audience: audience as string,
    scenes,
    formats,
    audio,
  };

  const warnings: string[] = [];
  const sb = resolveStoryboard(brief);
  const secs = totalSeconds(sb);
  const hook = sceneSeconds(scenes[0]);
  if (hook > GUIDANCE.hookMaxSec) warnings.push(`hook: first scene is ${hook}s — the first ${GUIDANCE.hookMaxSec}s decide whether people keep watching; shorten it`);
  if (secs > GUIDANCE.adMaxSec) warnings.push(`length: ${secs}s runs past the ${GUIDANCE.adMaxSec}s sweet spot for paid ads`);
  if ((formats ?? DEFAULT_FORMATS).includes('9:16') && secs > GUIDANCE.verticalMaxSec) warnings.push(`length: ${secs}s exceeds ${GUIDANCE.verticalMaxSec}s for vertical placements`);
  if (scenes[0].kind === 'cta') warnings.push('structure: opening on the CTA leaves no hook');
  return { ok: true, value: brief, warnings };
}

export function validateBrand(raw: unknown): ValidationResult<Brand> {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['brand: must be a JSON object'] };
  const name = checkStr(errors, 'brand.name', raw.name, 60);
  const tagline = checkStr(errors, 'brand.tagline', raw.tagline, 100, { optional: true });
  const logo = checkStr(errors, 'brand.logo', raw.logo, 400, { optional: true });
  if (logo && REMOTE_RE.test(logo)) errors.push('brand.logo: remote URLs are not supported — use a local file');
  const colors = isRecord(raw.colors) ? raw.colors : undefined;
  if (!colors) errors.push('brand.colors: required');
  const out = { bg: '', bgAlt: '', fg: '', muted: '', accent: '' };
  for (const k of Object.keys(out) as (keyof typeof out)[]) {
    const v = colors?.[k];
    if (typeof v !== 'string' || !HEX_RE.test(v)) { if (colors) errors.push(`brand.colors.${k}: must be a #rrggbb hex color`); }
    else out[k] = v;
  }
  const fonts = isRecord(raw.fonts) ? raw.fonts : undefined;
  if (!fonts) errors.push('brand.fonts: required');
  const heading = checkStr(errors, 'brand.fonts.heading', fonts?.heading, 200);
  const body = checkStr(errors, 'brand.fonts.body', fonts?.body, 200);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    warnings: [],
    value: {
      name: name as string,
      tagline,
      logo,
      colors: out,
      fonts: { heading: heading as string, body: body as string },
      placeholder: raw.placeholder === true ? true : undefined,
    },
  };
}

/** The brief `init-brief` writes, the Remotion Studio default, and the test fixture. */
export const SAMPLE_BRIEF: AdBrief = {
  slug: 'sample-ad',
  title: 'Sample ad (replace me)',
  objective: 'awareness',
  audience: 'Founders and operators drowning in manual workflows',
  formats: ['16:9', '9:16'],
  scenes: [
    { kind: 'title', headline: 'Your team is doing work a machine should do', durationSec: 3 },
    { kind: 'stat', value: '10x', label: 'faster than the manual process' },
    { kind: 'bullets', heading: 'What changes', items: ['Workflows run themselves', 'Humans handle exceptions', 'You see results daily'] },
    { kind: 'cta', text: 'Book a working session', url: 'leverageai.example/start' },
  ],
};
