import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const WORD = 'SHADOW';
// Cut-out line-art walk cycle (transparent outside the figure); see scripts/cutout.py
const WALK_FRAMES = 6;
const WALK_FRAME_SECONDS = 0.2;
const LETTER_WIDTH = 150;
// Matches the frames in public/walk-cutout/; wider than a letter so a walker hides the letter it is crossing
const WALKER_WIDTH = 162;
const WALKER_HEIGHT = 299;

const walkerBox = (x: number, y: number): React.CSSProperties => ({
  position: 'absolute',
  left: x - WALKER_WIDTH / 2,
  top: y - WALKER_HEIGHT / 2,
  width: WALKER_WIDTH,
  height: WALKER_HEIGHT,
});

export const ShadowReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const walkFrame = (Math.floor(frame / (fps * WALK_FRAME_SECONDS)) % WALK_FRAMES) + 1;

  const wordLeft = (width - WORD.length * LETTER_WIDTH) / 2;
  const centerX = width / 2;
  const centerY = height / 2;

  // Distance of each walker's centre from the screen centre. They start stacked on top of
  // each other so they read as a single figure, then walk at a constant pace (easing would make the feet look like they slide).
  const sweepStart = 30;
  const sweepEnd = durationInFrames - 30;
  const walkerOffset = interpolate(
    frame,
    [sweepStart, sweepEnd],
    [0, width / 2 + WALKER_WIDTH / 2],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {WORD.split('').map((letter, i) => {
        const letterLeft = wordLeft + i * LETTER_WIDTH;
        const letterRight = letterLeft + LETTER_WIDTH;
        // Each letter fades in behind the walker heading its way, as his back edge crosses it
        const [near, far] =
          letterLeft >= centerX
            ? [letterLeft - centerX, letterRight - centerX]
            : [centerX - letterRight, centerX - letterLeft];
        const trail = WALKER_WIDTH / 2;
        const opacity = interpolate(walkerOffset, [near + trail, far + trail], [0, 1], {
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
        <Img
          key={direction}
          src={staticFile(`walk-cutout/${walkFrame}.png`)}
          style={{
            ...walkerBox(centerX + direction * walkerOffset, centerY),
            // Mirrored copies can't line up, so only the right-moving one (drawn on top) is
            // visible while they are stacked; the other emerges from behind it as they part
            opacity:
              direction === 1
                ? 1
                : interpolate(walkerOffset, [0, WALKER_WIDTH * 0.6], [0, 1], {
                    extrapolateRight: 'clamp',
                  }),
            // The source faces right; mirror it so each walker faces the centre as it moves out
            transform: `scaleX(${-direction})`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};
