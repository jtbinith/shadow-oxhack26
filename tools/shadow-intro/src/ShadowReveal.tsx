import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const WORD = 'SHADOW';
const LETTER_WIDTH = 150;
const SPHERE_RADIUS = 70;

export const ShadowReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();

  const totalWordWidth = WORD.length * LETTER_WIDTH;
  const wordLeft = (width - totalWordWidth) / 2;
  const centerY = height / 2;

  // Sphere sweeps from off-screen left to off-screen right
  const sweepStart = 10;
  const sweepEnd = durationInFrames - 35;
  const sphereX = interpolate(
    frame,
    [sweepStart, sweepEnd],
    [-SPHERE_RADIUS * 2, width + SPHERE_RADIUS * 2],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Sphere fades out after the sweep
  const sphereOpacity = interpolate(
    frame,
    [sweepEnd, sweepEnd + 15],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Gentle bob so the sphere feels alive
  const sphereY = centerY + Math.sin(frame / 7) * 10;

  return (
    <AbsoluteFill style={{ backgroundColor: '#07070c', overflow: 'hidden' }}>
      {/* Faint ambient vignette */}
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(80,80,140,0.12) 0%, rgba(0,0,0,0) 65%)',
        }}
      />

      {/* Letters */}
      {WORD.split('').map((letter, i) => {
        const letterCenterX = wordLeft + i * LETTER_WIDTH + LETTER_WIDTH / 2;

        // Frame at which the sphere center crosses this letter
        const crossFrame = interpolate(
          letterCenterX,
          [-SPHERE_RADIUS * 2, width + SPHERE_RADIUS * 2],
          [sweepStart, sweepEnd]
        );

        const reveal = spring({
          frame: frame - crossFrame,
          fps,
          config: { damping: 14, stiffness: 120 },
        });

        const opacity = interpolate(reveal, [0, 1], [0, 1]);
        const translateY = interpolate(reveal, [0, 1], [38, 0]);
        const blur = interpolate(reveal, [0, 1], [14, 0]);

        // Letters glow briefly while the sphere is near them
        const distToSphere = Math.abs(sphereX - letterCenterX);
        const proximityGlow = interpolate(
          distToSphere,
          [0, 220],
          [1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        );

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: wordLeft + i * LETTER_WIDTH,
              top: 0,
              width: LETTER_WIDTH,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity,
              transform: `translateY(${translateY}px)`,
              filter: `blur(${blur}px)`,
            }}
          >
            <span
              style={{
                fontFamily: 'Helvetica, Arial, sans-serif',
                fontWeight: 800,
                fontSize: 160,
                letterSpacing: 2,
                color: '#e8e8f2',
                textShadow: `
                  0 0 ${18 + proximityGlow * 40}px rgba(140,160,255,${0.35 + proximityGlow * 0.6}),
                  0 10px 30px rgba(0,0,0,0.9)
                `,
              }}
            >
              {letter}
            </span>
          </div>
        );
      })}

      {/* The revealing sphere */}
      <div
        style={{
          position: 'absolute',
          left: sphereX - SPHERE_RADIUS,
          top: sphereY - SPHERE_RADIUS,
          width: SPHERE_RADIUS * 2,
          height: SPHERE_RADIUS * 2,
          borderRadius: '50%',
          opacity: sphereOpacity,
          background:
            'radial-gradient(circle at 32% 30%, #ffffff 0%, #b9c4ff 28%, #5a6cff 62%, #1b2370 100%)',
          boxShadow:
            '0 0 60px 25px rgba(120,140,255,0.55), 0 0 140px 60px rgba(90,108,255,0.25)',
        }}
      />
      {/* Light trail behind the sphere */}
      <div
        style={{
          position: 'absolute',
          left: sphereX - 320,
          top: sphereY - 5,
          width: 300,
          height: 10,
          opacity: sphereOpacity,
          borderRadius: 5,
          background:
            'linear-gradient(to right, rgba(120,140,255,0) 0%, rgba(120,140,255,0.55) 100%)',
          filter: 'blur(4px)',
        }}
      />
    </AbsoluteFill>
  );
};
