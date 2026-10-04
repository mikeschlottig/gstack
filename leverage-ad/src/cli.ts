#!/usr/bin/env bun
/**
 * leverage-ad CLI — brief in, finished video out.
 *
 *   leverage-ad setup                       install the Remotion engine (one time)
 *   leverage-ad doctor                      report engine / browser / brand status
 *   leverage-ad init-brief [file]           write a sample brief to edit
 *   leverage-ad validate <brief.json>       check the brief against the contract
 *   leverage-ad plan <brief.json>           print the resolved storyboard (no render)
 *   leverage-ad render <brief.json> [--formats 16:9,9:16] [--out dir] [--brand file] [--no-poster]
 *   leverage-ad frames <video.mp4> [--count 6]   extract review frames (paths on stdout)
 *
 * Output contract: stdout is ONLY output paths (one per line) for `render` /
 * `init-brief`, JSON for `validate --json` / `plan --json`; everything else
 * goes to stderr. Exit: 0 ok / 1 bad args or invalid brief / 2 render error /
 * 3 engine unavailable.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_FORMATS,
  FORMATS,
  FORMAT_IDS,
  SAMPLE_BRIEF,
  resolveStoryboard,
  sceneSeconds,
  totalSeconds,
  validateBrand,
  validateBrief,
  type AdBrief,
  type AdProps,
  type Brand,
  type FormatId,
} from '../shared/contract';
import {
  ENTRY,
  LICENSE_NOTICE,
  browserArgs,
  defaultBrandPath,
  engineInstalled,
  extractFrames,
  findBrowser,
  installEngine,
  probeVideo,
  receipt,
  runRemotion,
  userBrandPath,
} from './engine';

const EXIT = { OK: 0, USAGE: 1, RENDER: 2, ENGINE: 3 } as const;

function err(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read JSON from ${file}: ${(e as Error).message}`);
  }
}

interface Flags { positional: string[]; values: Record<string, string>; bools: Set<string> }

const VALUE_FLAGS = new Set(['formats', 'out', 'brand', 'count']);
const BOOL_FLAGS = new Set(['json', 'no-poster', 'help']);

function parseArgs(argv: string[]): Flags {
  const f: Flags = { positional: [], values: {}, bools: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { f.positional.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (BOOL_FLAGS.has(k)) f.bools.add(k);
    else if (VALUE_FLAGS.has(k)) {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new Error(`--${k} needs a value`);
      f.values[k] = v;
    } else throw new Error(`unknown flag --${k}`);
  }
  return f;
}

function loadBrief(file: string): { brief: AdBrief; warnings: string[]; dir: string } {
  const abs = path.resolve(file);
  const res = validateBrief(readJson(abs));
  if (!res.ok) throw new UsageError(`invalid brief ${file}:\n  - ${res.errors.join('\n  - ')}`);
  return { brief: res.value, warnings: res.warnings, dir: path.dirname(abs) };
}

class UsageError extends Error {}

/** brand: --brand > <briefdir>/brand.json > ~/.gstack/leverage-ad/brand.json > shipped placeholder. */
function resolveBrandFile(briefDir: string, flag?: string): string {
  if (flag) return path.resolve(flag);
  for (const c of [path.join(briefDir, 'brand.json'), userBrandPath()]) if (fs.existsSync(c)) return c;
  return defaultBrandPath();
}

function loadBrand(file: string): Brand {
  const res = validateBrand(readJson(file));
  if (!res.ok) throw new UsageError(`invalid brand ${file}:\n  - ${res.errors.join('\n  - ')}`);
  return res.value;
}

function mustExist(file: string, what: string): string {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new UsageError(`${what} not found: ${file}`);
  return file;
}

function pickFormats(brief: AdBrief, flag?: string): FormatId[] {
  if (!flag) return brief.formats ?? DEFAULT_FORMATS;
  const want = flag.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = want.filter((f) => !(FORMAT_IDS as readonly string[]).includes(f));
  if (bad.length) throw new UsageError(`unknown format(s) ${bad.join(', ')} (valid: ${FORMAT_IDS.join(', ')})`);
  return [...new Set(want)] as FormatId[];
}

// ---------- commands ----------

function cmdDoctor(): number {
  const engine = engineInstalled();
  const browser = findBrowser();
  const user = userBrandPath();
  const brandSrc = fs.existsSync(user) ? user : defaultBrandPath();
  const brand = loadBrand(brandSrc);
  err(`engine:  ${engine ? 'installed' : 'MISSING — run: leverage-ad setup'}`);
  err(`browser: ${browser ? `${browser.path} (${browser.mode})` : 'none found — Remotion will download Chrome Headless Shell on first render (~100MB)'}`);
  err(`brand:   ${brand.name} (${brandSrc})${brand.placeholder ? ' — PLACEHOLDER colors; set real brand tokens' : ''}`);
  err(LICENSE_NOTICE);
  return engine ? EXIT.OK : EXIT.ENGINE;
}

function cmdInitBrief(file?: string): number {
  const out = path.resolve(file ?? 'ad-brief.json');
  if (fs.existsSync(out)) throw new UsageError(`${out} already exists — pick another path or delete it`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(SAMPLE_BRIEF, null, 2)}\n`);
  process.stdout.write(`${out}\n`);
  return EXIT.OK;
}

function cmdValidate(file: string, json: boolean): number {
  const { brief, warnings } = loadBrief(file);
  const sb = resolveStoryboard(brief);
  if (json) process.stdout.write(`${JSON.stringify({ ok: true, seconds: totalSeconds(sb), warnings })}\n`);
  else {
    err(`ok: ${brief.scenes.length} scenes, ${totalSeconds(sb)}s`);
    warnings.forEach((w) => err(`warning: ${w}`));
  }
  return EXIT.OK;
}

function cmdPlan(file: string, json: boolean): number {
  const { brief, warnings } = loadBrief(file);
  const sb = resolveStoryboard(brief);
  if (json) {
    process.stdout.write(`${JSON.stringify({ seconds: totalSeconds(sb), storyboard: sb, warnings })}\n`);
    return EXIT.OK;
  }
  sb.scenes.forEach((rs, i) => {
    const at = (rs.startFrame / sb.fps).toFixed(1).padStart(5);
    err(`${String(i + 1).padStart(2)}. ${at}s  ${sceneSeconds(rs.scene).toFixed(1)}s  ${rs.scene.kind}`);
  });
  err(`total ${totalSeconds(sb)}s @ ${sb.fps}fps`);
  warnings.forEach((w) => err(`warning: ${w}`));
  return EXIT.OK;
}

/** Copy a local asset into the render's public dir under a collision-free name. */
function stage(publicDir: string, name: string, src: string): string {
  const ext = path.extname(src).toLowerCase();
  const staged = `${name}${ext}`;
  fs.copyFileSync(src, path.join(publicDir, staged));
  return staged;
}

function cmdFrames(video: string, countFlag?: string): number {
  const count = countFlag === undefined ? 6 : Number(countFlag);
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new UsageError('--count must be an integer from 1 to 24');
  if (!engineInstalled()) { err('engine not installed — run: leverage-ad setup'); return EXIT.ENGINE; }
  const abs = mustExist(path.resolve(video), 'video');
  const frames = extractFrames(abs, abs.replace(/\.[^.]+$/, '-frames'), count);
  if (frames.length === 0) { err(`could not extract frames from ${video}`); return EXIT.RENDER; }
  frames.forEach((f) => process.stdout.write(`${f}\n`));
  return EXIT.OK;
}

function cmdRender(file: string, flags: Flags): number {
  const { brief, warnings, dir } = loadBrief(file);
  const brandFile = resolveBrandFile(dir, flags.values.brand);
  const brand = loadBrand(mustExist(brandFile, 'brand file'));
  const formats = pickFormats(brief, flags.values.formats);
  warnings.forEach((w) => err(`warning: ${w}`));
  if (brand.placeholder) err('warning: using the PLACEHOLDER brand — set real colors/logo (see SKILL.md Step 0) before publishing');

  // Cheap checks first: every referenced asset must exist before we touch the engine.
  const resolved = {
    images: brief.scenes.map((s) => (s.kind === 'image' ? mustExist(path.resolve(dir, s.src), `image "${s.src}"`) : undefined)),
    music: brief.audio?.music ? mustExist(path.resolve(dir, brief.audio.music), `music "${brief.audio.music}"`) : undefined,
    voiceover: brief.audio?.voiceover ? mustExist(path.resolve(dir, brief.audio.voiceover), `voiceover "${brief.audio.voiceover}"`) : undefined,
    logo: brand.logo ? mustExist(path.resolve(path.dirname(brandFile), brand.logo), `brand logo "${brand.logo}"`) : undefined,
  };

  if (!engineInstalled()) {
    err('engine not installed — run: leverage-ad setup');
    return EXIT.ENGINE;
  }

  const outRoot = path.resolve(flags.values.out ?? path.join(dir, 'out'), brief.slug);
  const work = path.join(outRoot, '.work');
  const publicDir = path.join(work, 'public');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(publicDir, { recursive: true });

  // Stage every local asset; scene/audio/logo references become staged filenames.
  const staged = resolveStoryboard({
    ...brief,
    scenes: brief.scenes.map((s, i) => {
      const src = resolved.images[i];
      return s.kind === 'image' && src ? { ...s, src: stage(publicDir, `img-${i}`, src) } : s;
    }),
  });
  const music = resolved.music ? stage(publicDir, 'music', resolved.music) : undefined;
  const voiceover = resolved.voiceover ? stage(publicDir, 'voiceover', resolved.voiceover) : undefined;
  const logo = resolved.logo ? stage(publicDir, 'logo', resolved.logo) : undefined;

  const browser = findBrowser();
  if (!browser) receipt('storage.googleapis.com', 'chrome-headless-shell-download', 'user-invoked: leverage-ad render (no local browser found)');

  fs.writeFileSync(path.join(outRoot, 'storyboard.json'), `${JSON.stringify({ brief, storyboard: staged }, null, 2)}\n`);

  const outputs: { format: FormatId; video: string; poster?: string; seconds?: number; bytes: number }[] = [];
  for (const format of formats) {
    const spec = FORMATS[format];
    const props: AdProps = {
      storyboard: staged,
      brand,
      format,
      audio: { music, musicVolume: brief.audio?.musicVolume ?? 0.25, voiceover },
      logo,
    };
    const propsFile = path.join(work, `props-${spec.compId}.json`);
    fs.writeFileSync(propsFile, JSON.stringify(props));
    const common = [`--props=${propsFile}`, `--public-dir=${publicDir}`, '--log=error', ...browserArgs(browser)];

    const video = path.join(outRoot, `${brief.slug}-${spec.compId.replace('Ad-', '')}.mp4`);
    err(`rendering ${format} (${spec.width}x${spec.height}, ${totalSeconds(staged)}s)...`);
    const code = runRemotion(['render', ENTRY, spec.compId, video, '--codec=h264', ...common]);
    if (code !== 0 || !fs.existsSync(video)) {
      err(`render failed for ${format} (exit ${code})`);
      return EXIT.RENDER;
    }

    let poster: string | undefined;
    if (!flags.bools.has('no-poster')) {
      poster = video.replace(/\.mp4$/, '-poster.png');
      const frame = Math.min(staged.totalFrames - 1, 36);
      if (runRemotion(['still', ENTRY, spec.compId, poster, `--frame=${frame}`, ...common]) !== 0) {
        err(`warning: poster render failed for ${format}; video is fine`);
        poster = undefined;
      }
    }

    const info = probeVideo(video);
    if (info && (info.width !== spec.width || info.height !== spec.height)) {
      err(`render check failed: ${format} came out ${info.width}x${info.height}, expected ${spec.width}x${spec.height}`);
      return EXIT.RENDER;
    }
    if (!info) err(`warning: could not verify ${path.basename(video)} with ffprobe`);
    outputs.push({ format, video, poster, seconds: info?.durationSec, bytes: fs.statSync(video).size });
  }

  fs.rmSync(work, { recursive: true, force: true });
  fs.writeFileSync(
    path.join(outRoot, 'render-report.json'),
    `${JSON.stringify({ slug: brief.slug, brand: brand.name, brandPlaceholder: !!brand.placeholder, outputs, warnings }, null, 2)}\n`,
  );
  for (const o of outputs) {
    process.stdout.write(`${o.video}\n`);
    if (o.poster) process.stdout.write(`${o.poster}\n`);
  }
  return EXIT.OK;
}

const USAGE = `leverage-ad — brief in, finished video out
  setup | doctor | init-brief [file] | validate <brief> [--json] | plan <brief> [--json]
  render <brief> [--formats 16:9,9:16,1:1,4:5] [--out dir] [--brand file] [--no-poster]
  frames <video.mp4> [--count 6]`;

function main(argv: string[]): number {
  try {
    const [cmd, ...rest] = argv;
    if (!cmd || cmd === '--help' || cmd === 'help') { err(USAGE); return cmd ? EXIT.OK : EXIT.USAGE; }
    const flags = parseArgs(rest);
    const arg = flags.positional[0];
    const needBrief = (): string => {
      if (!arg) throw new UsageError(`${cmd}: missing <brief.json>\n${USAGE}`);
      return arg;
    };
    switch (cmd) {
      case 'setup': {
        const code = installEngine();
        if (code !== 0) { err('engine install failed'); return EXIT.ENGINE; }
        return cmdDoctor();
      }
      case 'doctor': return cmdDoctor();
      case 'init-brief': return cmdInitBrief(arg);
      case 'validate': return cmdValidate(needBrief(), flags.bools.has('json'));
      case 'plan': return cmdPlan(needBrief(), flags.bools.has('json'));
      case 'render': return cmdRender(needBrief(), flags);
      case 'frames': return cmdFrames(needBrief(), flags.values.count);
      default: throw new UsageError(`unknown command "${cmd}"\n${USAGE}`);
    }
  } catch (e) {
    if (e instanceof UsageError) { err(e.message); return EXIT.USAGE; }
    err((e as Error).message);
    return EXIT.USAGE;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));

export { main, parseArgs };
