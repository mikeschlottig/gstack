import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Audio } from '@remotion/media';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { TRANSITION_FRAMES, type AdProps, type Scene } from '../../shared/contract';
import { makeLayout, type Layout } from './layout';
import { BulletsScene, CtaScene, ImageScene, QuoteScene, StatScene, StatementScene, TitleScene } from './scenes';

const SceneView: React.FC<{ scene: Scene; brand: AdProps['brand']; L: Layout }> = ({ scene, brand, L }) => {
  switch (scene.kind) {
    case 'title': return <TitleScene scene={scene} brand={brand} L={L} />;
    case 'statement': return <StatementScene scene={scene} brand={brand} L={L} />;
    case 'bullets': return <BulletsScene scene={scene} brand={brand} L={L} />;
    case 'stat': return <StatScene scene={scene} brand={brand} L={L} />;
    case 'image': return <ImageScene scene={scene} brand={brand} L={L} />;
    case 'quote': return <QuoteScene scene={scene} brand={brand} L={L} />;
    case 'cta': return <CtaScene scene={scene} brand={brand} L={L} />;
  }
};

const Chrome: React.FC<{ props: AdProps; L: Layout }> = ({ props, L }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { brand } = props;
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <>
      <div style={{ position: 'absolute', left: L.padX, top: Math.round(56 * L.u), display: 'flex', alignItems: 'center', gap: Math.round(16 * L.u) }}>
        {props.logo ? (
          <Img src={staticFile(props.logo)} style={{ height: Math.round(56 * L.u), width: 'auto' }} />
        ) : (
          <div style={{ fontFamily: brand.fonts.heading, fontWeight: 800, fontSize: Math.round(40 * L.u), color: brand.colors.fg, letterSpacing: 0.5 }}>{brand.name}</div>
        )}
      </div>
      <div style={{ position: 'absolute', left: 0, top: 0, height: Math.max(4, Math.round(8 * L.u)), width: `${progress * 100}%`, background: brand.colors.accent }} />
    </>
  );
};

export const Ad: React.FC<AdProps> = (props) => {
  const { storyboard, brand, audio, format } = props;
  const L = makeLayout(format);
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeVol = (base: number) =>
    base *
    interpolate(frame, [0, 10, durationInFrames - 30, durationInFrames], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${brand.colors.bg} 0%, ${brand.colors.bgAlt} 100%)` }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 85% 10%, ${brand.colors.accent}33 0%, transparent 55%)` }} />
      <TransitionSeries>
        {storyboard.scenes.flatMap((rs, i) => {
          const nodes: React.ReactElement[] = [];
          if (i > 0) {
            nodes.push(
              <TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />,
            );
          }
          nodes.push(
            <TransitionSeries.Sequence key={`s${i}`} durationInFrames={rs.frames}>
              <SceneView scene={rs.scene} brand={brand} L={L} />
            </TransitionSeries.Sequence>,
          );
          return nodes;
        })}
      </TransitionSeries>
      <Chrome props={props} L={L} />
      {audio.music ? <Audio src={staticFile(audio.music)} volume={() => fadeVol(audio.musicVolume)} loop /> : null}
      {audio.voiceover ? <Audio src={staticFile(audio.voiceover)} volume={1} /> : null}
    </AbsoluteFill>
  );
};
