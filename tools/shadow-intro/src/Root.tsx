import React from 'react';
import { Composition } from 'remotion';
import { ShadowReveal } from './ShadowReveal';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ShadowReveal"
      component={ShadowReveal}
      durationInFrames={150}
      fps={30}
      width={1280}
      height={720}
    />
  );
};
