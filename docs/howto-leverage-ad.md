# Video ads with /leverage-ad

`/leverage-ad` turns a short brief into finished, branded video ads: one MP4 and
one poster PNG per format (16:9, 9:16, 1:1, 4:5), rendered locally and offline
with [Remotion](https://www.remotion.dev). The skill writes the storyboard,
renders, extracts frames, looks at them, and iterates before delivering.

## Quick start

```bash
bun leverage-ad/src/cli.ts setup                  # one time: installs the Remotion engine (~270MB)
bun leverage-ad/src/cli.ts init-brief ads/demo/brief.json
bun leverage-ad/src/cli.ts validate ads/demo/brief.json
bun leverage-ad/src/cli.ts render ads/demo/brief.json   # -> ads/demo/out/<slug>/
bun leverage-ad/src/cli.ts frames ads/demo/out/<slug>/<slug>-9x16.mp4 --count 6
```

In Claude Code just ask: "make a 20-second video ad for ..." and the skill drives
all of this.

## The brief

One JSON file is the source of truth. Contract: `leverage-ad/shared/contract.ts`
(shared by the CLI and the render engine, so they cannot drift).

| Scene `kind` | Fields |
|---|---|
| `title` | `headline` (≤80), `sub?` (≤100) |
| `statement` | `text` (≤140) |
| `bullets` | `heading?`, `items` (2-5, ≤60 each) |
| `stat` | `value` (≤12; `$2.4M`, `85%`, `10x` count up), `label` (≤60) |
| `image` | `src` (local file), `caption?` (≤100) |
| `quote` | `text` (≤180), `attribution` (≤60) |
| `cta` | `text` (≤60), `url?` — must be the last scene, and the only one |

Top level: `slug`, `title`, `objective` (`awareness|leads|demo|recruiting|announcement`),
`audience`, `scenes` (2-12), optional `formats`, `audio` (`music`, `musicVolume`,
`voiceover`: local files, relative to the brief). `durationSec` (1.5-12) overrides
a scene's reading-time default. Soft guidance (warnings, not errors): hook ≤3.5s,
ad ≤30s, vertical ≤60s.

Remote URLs are rejected everywhere by design: renders stay offline and reproducible.

## Brand

Resolution order: `--brand file` → `<brief folder>/brand.json` →
`~/.gstack/leverage-ad/brand.json` → the shipped placeholder
(`leverage-ad/brand/leverageai.default.json`, flagged `"placeholder": true`; renders
warn until you set real tokens). Shape: `name`, `tagline?`, `logo?` (path relative to
the brand file), `colors` (`bg`, `bgAlt`, `fg`, `muted`, `accent` as `#rrggbb`),
`fonts` (`heading`, `body` CSS stacks; system fonts only, nothing is fetched).

## Formats

| id | size | for |
|---|---|---|
| `16:9` | 1920×1080 | YouTube, LinkedIn, site hero |
| `9:16` | 1080×1920 | Reels, Shorts, TikTok, Stories (bottom 18% kept clear) |
| `1:1` | 1080×1080 | feed |
| `4:5` | 1080×1350 | tall feed |

Each render is verified with ffprobe (dimensions, duration) and written to
`render-report.json`.

## Engine, license and network

- Remotion is source-available, **not** MIT: free for individuals and teams of up to
  3 people; teams of 4+ need a [Company License](https://www.remotion.pro). It also
  sends render telemetry used for license accountability. `setup` prints this every time.
- It is therefore never a root dependency of gstack. `setup` runs `npm install` in
  `leverage-ad/remotion/` (versions pinned in lockstep; `node_modules` is gitignored).
- Egress is receipted (`~/.gstack/security/egress.jsonl`) before `setup`'s npm install and
  before a first-render Chrome download.
- Browser: a standalone Chrome Headless Shell is preferred (Playwright's
  `chromium_headless_shell-*` is found automatically). A desktop Chrome is driven in
  `chrome-for-testing` mode. Override with `LEVERAGE_AD_BROWSER=/path/to/binary`. With
  no browser, Remotion downloads one on first render.

## Verified engine notes (Remotion 4.0.532)

- `remotion render <entry> <comp-id> <out> --props=<file> --public-dir=<dir> --browser-executable=<path>`;
  `remotion still ... --frame=N`; `remotion ffmpeg` / `remotion ffprobe` ship with it.
- A full desktop Chromium launched without `--chrome-mode=chrome-for-testing` fails with
  "Old Headless mode has been removed" — use a headless shell or that flag.
- Remotion's bundled ffmpeg is a reduced build (no `gradients`/`testsrc2` filters); don't
  rely on lavfi generators in tooling.
- Audio uses `Audio` from `@remotion/media`; transitions use `@remotion/transitions`
  (`TransitionSeries` shortens total duration by the overlap, which the storyboard accounts for).

## Tests

`bun test leverage-ad/test` (free; also part of `bun run test`). The real render check is
opt-in: `LEVERAGE_AD_E2E=1 bun test leverage-ad/test/cli.test.ts` (needs `setup` first).

## Extending

- New scene kind: `SCENE_KINDS` + the `Scene` union + a validator branch in
  `shared/contract.ts`, a component in `remotion/src/scenes.tsx`, and a `case` in
  `remotion/src/Ad.tsx` (a tripwire test fails until all three agree).
- New format: add it to `FORMATS` (one composition per format is registered from it).
- Not built yet: text-to-speech voiceover and auto-captions (`@remotion/elevenlabs`,
  `@remotion/openai-whisper` are already in the engine's dependency tree) and a
  generated-clip (text-to-video API) scene kind.
