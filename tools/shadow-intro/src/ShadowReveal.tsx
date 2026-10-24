import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { Gif } from '@remotion/gif';

const WORD = 'SHADOW';
const LETTER_WIDTH = 150;
// Matches public/walk.gif; wider than a letter so a walker hides the letter it is crossing
const WALKER_WIDTH = 162;
const WALKER_HEIGHT = 299;

export const ShadowReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  const wordLeft = (width - WORD.length * LETTER_WIDTH) / 2;
  const centerX = width / 2;
  const centerY = height / 2;

  // Distance of each walker's centre from the screen centre. They start back to back
  // and walk at a constant pace (easing would make the feet look like they slide).
  const sweepStart = 30;
  const sweepEnd = durationInFrames - 30;
  const walkerOffset = interpolate(
    frame,
    [sweepStart, sweepEnd],
    [WALKER_WIDTH / 2, width / 2 + WALKER_WIDTH / 2],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {WORD.split('').map((letter, i) => {
        const letterLeft = wordLeft + i * LETTER_WIDTH;
        const letterRight = letterLeft + LETTER_WIDTH;
        // Each letter fades in as the walker heading its way crosses it
        const [near, far] =
          letterLeft >= centerX
            ? [letterLeft - centerX, letterRight - centerX]
            : [centerX - letterRight, centerX - letterLeft];
        const opacity = interpolate(walkerOffset, [near, far], [0, 1], {
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

      {[-1, 1].map((direction) => (
        <div
          key={direction}
          style={{
            position: 'absolute',
            left: centerX + direction * walkerOffset - WALKER_WIDTH / 2,
            top: centerY - WALKER_HEIGHT / 2,
            width: WALKER_WIDTH,
            height: WALKER_HEIGHT,
            // The source walks right; mirror the left-hand walker
            transform: `scaleX(${direction})`,
          }}
        >
          <Gif
            src={staticFile('walk.gif')}
            width={WALKER_WIDTH}
            height={WALKER_HEIGHT}
            fit="fill"
            loopBehavior="loop"
          />
        </div>
      ))}
    </AbsoluteFill>
  );
};
