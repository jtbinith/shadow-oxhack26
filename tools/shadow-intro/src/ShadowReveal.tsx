import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const WORD = 'SHADOW';
const LETTER_WIDTH = 150;
// Two panels side by side cover the whole word at the start
const RECT_WIDTH = (WORD.length * LETTER_WIDTH) / 2;
const RECT_HEIGHT = 280;

export const ShadowReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  const wordLeft = (width - WORD.length * LETTER_WIDTH) / 2;
  const centerY = height / 2;

  const centerX = width / 2;

  // Both panels meet at the centre, then their inner edges drift apart to the screen edges
  const sweepStart = 30;
  const sweepEnd = durationInFrames - 45;
  const offset = interpolate(
    frame,
    [sweepStart, sweepEnd],
    [0, width / 2],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.sin),
    }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {WORD.split('').map((letter, i) => {
        const letterLeft = wordLeft + i * LETTER_WIDTH;
        const letterRight = letterLeft + LETTER_WIDTH;
        // Each letter fades in as the inner edge of the panel heading its way passes over it
        const [near, far] =
          letterLeft >= centerX
            ? [letterLeft - centerX, letterRight - centerX]
            : [centerX - letterRight, centerX - letterLeft];
        const opacity = interpolate(offset, [near, far], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: letterLeft,
              top: 0,
              width: LETTER_WIDTH,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity,
            }}
          >
            <span
              style={{
                fontFamily: 'Helvetica, Arial, sans-serif',
                fontWeight: 800,
                fontSize: 160,
                color: '#fff',
              }}
            >
              {letter}
            </span>
          </div>
        );
      })}

      {[centerX - offset - RECT_WIDTH, centerX + offset].map((left, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left,
            top: centerY - RECT_HEIGHT / 2,
            width: RECT_WIDTH,
            height: RECT_HEIGHT,
            backgroundColor: '#000',
          }}
        />
      ))}
    </AbsoluteFill>
  );
};
