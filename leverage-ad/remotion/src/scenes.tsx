import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Brand, Scene } from '../../shared/contract';
import { fitSize, type Layout } from './layout';

interface SceneProps<S extends Scene> {
  scene: S;
  brand: Brand;
  L: Layout;
  /** Scene `src` values are staged filenames in the render's public dir. */
}

/** 0 -> 1 entrance, staggered by `delay` frames. */
function useEnter(delay = 0): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 22 });
}

const rise = (t: number, px: number) => `translateY(${(1 - t) * px}px)`;

function Frame({ L, children }: { L: Layout; children: React.ReactNode }) {
  return (
    <AbsoluteFill
      style={{
        padding: `${L.padTop}px ${L.padX}px ${L.padBottom}px`,
        justifyContent: 'center',
        alignItems: 'flex-start',
        flexDirection: 'column',
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function AccentRule({ brand, L, t }: { brand: Brand; L: Layout; t: number }) {
  return (
    <div
      style={{
        width: Math.round(120 * L.u) * t,
        height: Math.round(8 * L.u),
        borderRadius: 8,
        background: brand.colors.accent,
        marginBottom: Math.round(40 * L.u),
      }}
    />
  );
}

export const TitleScene: React.FC<SceneProps<Extract<Scene, { kind: 'title' }>>> = ({ scene, brand, L }) => {
  const t = useEnter();
  const t2 = useEnter(8);
  const size = fitSize(scene.headline, [128, 104, 84], [28, 52], L.u);
  return (
    <Frame L={L}>
      <AccentRule brand={brand} L={L} t={t} />
      <div style={{ fontFamily: brand.fonts.heading, fontWeight: 800, fontSize: size, lineHeight: 1.05, color: brand.colors.fg, maxWidth: L.maxW, opacity: t, transform: rise(t, 40 * L.u), letterSpacing: -1 }}>
        {scene.headline}
      </div>
      {scene.sub ? (
        <div style={{ fontFamily: brand.fonts.body, fontSize: Math.round(44 * L.u), color: brand.colors.muted, marginTop: Math.round(36 * L.u), maxWidth: L.maxW, opacity: t2, transform: rise(t2, 24 * L.u), lineHeight: 1.3 }}>
          {scene.sub}
        </div>
      ) : null}
    </Frame>
  );
};

export const StatementScene: React.FC<SceneProps<Extract<Scene, { kind: 'statement' }>>> = ({ scene, brand, L }) => {
  const t = useEnter();
  const size = fitSize(scene.text, [104, 88, 72], [40, 80], L.u);
  return (
    <Frame L={L}>
      <AccentRule brand={brand} L={L} t={t} />
      <div style={{ fontFamily: brand.fonts.heading, fontWeight: 700, fontSize: size, lineHeight: 1.12, color: brand.colors.fg, maxWidth: L.maxW, opacity: t, transform: rise(t, 36 * L.u) }}>
        {scene.text}
      </div>
    </Frame>
  );
};

export const BulletsScene: React.FC<SceneProps<Extract<Scene, { kind: 'bullets' }>>> = ({ scene, brand, L }) => {
  const head = useEnter();
  const size = Math.round((scene.items.some((i) => i.length > 40) ? 52 : 62) * L.u);
  return (
    <Frame L={L}>
      {scene.heading ? (
        <div style={{ fontFamily: brand.fonts.heading, fontWeight: 800, fontSize: Math.round(72 * L.u), color: brand.colors.accent, marginBottom: Math.round(44 * L.u), opacity: head, transform: rise(head, 30 * L.u), maxWidth: L.maxW, lineHeight: 1.1 }}>
          {scene.heading}
        </div>
      ) : null}
      {scene.items.map((item, i) => (
        <BulletRow key={i} text={item} index={i} brand={brand} L={L} size={size} />
      ))}
    </Frame>
  );
};

const BulletRow: React.FC<{ text: string; index: number; brand: Brand; L: Layout; size: number }> = ({ text, index, brand, L, size }) => {
  const t = useEnter(10 + index * 9);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: Math.round(28 * L.u), marginBottom: Math.round(30 * L.u), maxWidth: L.maxW, opacity: t, transform: `translateX(${(1 - t) * -50 * L.u}px)` }}>
      <div style={{ flex: 'none', width: Math.round(18 * L.u), height: Math.round(18 * L.u), marginTop: Math.round(size * 0.42), borderRadius: 999, background: brand.colors.accent }} />
      <div style={{ fontFamily: brand.fonts.body, fontWeight: 600, fontSize: size, lineHeight: 1.15, color: brand.colors.fg }}>{text}</div>
    </div>
  );
};

/** "$2.4M", "85%", "10x", "3,000+" -> animate the number, keep the affixes. */
function countUp(value: string, progress: number): string {
  const m = /^([^0-9]*)([0-9][0-9,]*(?:\.[0-9]+)?)(.*)$/.exec(value);
  if (!m) return value;
  const [, pre, num, post] = m;
  const target = parseFloat(num.replace(/,/g, ''));
  if (!Number.isFinite(target)) return value;
  const decimals = num.includes('.') ? num.split('.')[1].length : 0;
  const cur = target * progress;
  const text = decimals ? cur.toFixed(decimals) : Math.round(cur).toString();
  const withCommas = num.includes(',') ? Number(text).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : text;
  return `${pre}${withCommas}${post}`;
}

export const StatScene: React.FC<SceneProps<Extract<Scene, { kind: 'stat' }>>> = ({ scene, brand, L }) => {
  const frame = useCurrentFrame();
  const t = useEnter();
  const t2 = useEnter(14);
  const progress = interpolate(frame, [4, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const eased = 1 - Math.pow(1 - progress, 3);
  return (
    <Frame L={L}>
      <div style={{ fontFamily: brand.fonts.heading, fontWeight: 900, fontSize: Math.round((scene.value.length > 6 ? 220 : 300) * L.u), lineHeight: 1, color: brand.colors.accent, opacity: t, transform: rise(t, 40 * L.u), letterSpacing: -4 }}>
        {countUp(scene.value, eased)}
      </div>
      <div style={{ fontFamily: brand.fonts.body, fontWeight: 600, fontSize: Math.round(60 * L.u), color: brand.colors.fg, marginTop: Math.round(24 * L.u), maxWidth: L.maxW, opacity: t2, transform: rise(t2, 24 * L.u), lineHeight: 1.2 }}>
        {scene.label}
      </div>
    </Frame>
  );
};

export const ImageScene: React.FC<SceneProps<Extract<Scene, { kind: 'image' }>>> = ({ scene, brand, L }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoom = interpolate(frame, [0, durationInFrames], [1.0, 1.08]);
  const t = useEnter(6);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Img src={staticFile(scene.src)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
      </AbsoluteFill>
      {scene.caption ? (
        <>
          <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 55%)' }} />
          <AbsoluteFill style={{ padding: `0 ${L.padX}px ${L.padBottom}px`, justifyContent: 'flex-end' }}>
            <div style={{ fontFamily: brand.fonts.heading, fontWeight: 800, fontSize: fitSize(scene.caption, [84, 68, 56], [32, 60], L.u), color: '#FFFFFF', lineHeight: 1.1, maxWidth: L.maxW, opacity: t, transform: rise(t, 30 * L.u) }}>
              {scene.caption}
            </div>
          </AbsoluteFill>
        </>
      ) : null}
    </AbsoluteFill>
  );
};

export const QuoteScene: React.FC<SceneProps<Extract<Scene, { kind: 'quote' }>>> = ({ scene, brand, L }) => {
  const t = useEnter();
  const t2 = useEnter(16);
  return (
    <Frame L={L}>
      <div style={{ fontFamily: brand.fonts.heading, fontWeight: 900, fontSize: Math.round(220 * L.u), lineHeight: 0.7, color: brand.colors.accent, opacity: t }}>&ldquo;</div>
      <div style={{ fontFamily: brand.fonts.heading, fontWeight: 600, fontSize: fitSize(scene.text, [76, 62, 52], [70, 120], L.u), lineHeight: 1.18, color: brand.colors.fg, maxWidth: L.maxW, opacity: t, transform: rise(t, 30 * L.u), marginTop: Math.round(20 * L.u) }}>
        {scene.text}
      </div>
      <div style={{ fontFamily: brand.fonts.body, fontWeight: 600, fontSize: Math.round(42 * L.u), color: brand.colors.muted, marginTop: Math.round(40 * L.u), opacity: t2 }}>
        {scene.attribution}
      </div>
    </Frame>
  );
};

export const CtaScene: React.FC<SceneProps<Extract<Scene, { kind: 'cta' }>>> = ({ scene, brand, L }) => {
  const t = useEnter();
  const t2 = useEnter(10);
  const t3 = useEnter(20);
  return (
    <Frame L={L}>
      <div style={{ fontFamily: brand.fonts.heading, fontWeight: 800, fontSize: fitSize(scene.text, [112, 92, 76], [26, 46], L.u), lineHeight: 1.05, color: brand.colors.fg, maxWidth: L.maxW, opacity: t, transform: rise(t, 40 * L.u), letterSpacing: -1 }}>
        {scene.text}
      </div>
      {scene.url ? (
        <div style={{ marginTop: Math.round(48 * L.u), padding: `${Math.round(22 * L.u)}px ${Math.round(44 * L.u)}px`, borderRadius: 999, background: brand.colors.accent, color: '#FFFFFF', fontFamily: brand.fonts.body, fontWeight: 700, fontSize: Math.round(52 * L.u), opacity: t2, transform: `scale(${0.9 + 0.1 * t2})`, maxWidth: L.maxW, wordBreak: 'break-word' }}>
          {scene.url}
        </div>
      ) : null}
      <div style={{ marginTop: Math.round(48 * L.u), fontFamily: brand.fonts.body, fontWeight: 600, fontSize: Math.round(40 * L.u), color: brand.colors.muted, opacity: t3 }}>
        {brand.name}
        {brand.tagline ? ` — ${brand.tagline}` : ''}
      </div>
    </Frame>
  );
};
