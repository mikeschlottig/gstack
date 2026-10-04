import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { Ad } from './Ad';
import {
  FORMATS,
  FORMAT_IDS,
  FPS,
  SAMPLE_BRIEF,
  resolveStoryboard,
  validateBrand,
  type AdProps,
  type FormatId,
} from '../../shared/contract';
import defaultBrand from '../../brand/leverageai.default.json';

const brand = validateBrand(defaultBrand);
if (!brand.ok) throw new Error(`default brand invalid: ${brand.errors.join('; ')}`);

const sampleProps = (format: FormatId): AdProps => ({
  storyboard: resolveStoryboard(SAMPLE_BRIEF),
  brand: brand.value,
  format,
  audio: { musicVolume: 0.25 },
});

// Duration comes from the storyboard in the input props, so one composition
// per format fits any brief the CLI hands it.
const calculateMetadata: CalculateMetadataFunction<AdProps> = ({ props }) => ({
  durationInFrames: Math.max(1, props.storyboard.totalFrames),
  fps: props.storyboard.fps,
});

export const Root: React.FC = () => (
  <>
    {FORMAT_IDS.map((id) => (
      <Composition
        key={id}
        id={FORMATS[id].compId}
        component={Ad}
        width={FORMATS[id].width}
        height={FORMATS[id].height}
        fps={FPS}
        durationInFrames={resolveStoryboard(SAMPLE_BRIEF).totalFrames}
        defaultProps={sampleProps(id)}
        calculateMetadata={calculateMetadata}
      />
    ))}
  </>
);
