import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {COLORS, FONTS} from '../theme';
import {getSceneTransition} from '../transitions';

type Stat = {
  finalValue: number;
  unit: string;
  label: string;
  glow: boolean;
};

const STATS: Stat[] = [
  {
    finalValue: 60,
    unit: 'SEC',
    label: 'Time to first follow-up',
    glow: false,
  },
  {
    finalValue: 100,
    unit: '%',
    label: 'Of leads followed up',
    glow: true,
  },
  {
    finalValue: 0,
    unit: '',
    label: 'Manual tasks required',
    glow: false,
  },
];

type Props = {
  sceneDuration: number;
};

export const Scene05: React.FC<Props> = ({sceneDuration}) => {
  const rawFrame = useCurrentFrame();
  // Shift internal animations by 15f so they begin after the entrance transition completes.
  const frame = Math.max(0, rawFrame - 15);
  const transition = getSceneTransition(rawFrame, sceneDuration);

  /* Eyebrow fade */
  const labelOpacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: 'clamp',
  });

  /* Subtle continuous Power Blue radial glow pulse behind the 100% stat */
  const pulse = (Math.sin((frame / 45) * Math.PI * 2) + 1) / 2; // 0..1
  const glowOpacity = 0.28 + pulse * 0.32;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.deepBlack,
        alignItems: 'center',
        paddingTop: 220,
        opacity: transition.opacity,
        transform: `translateY(${transition.translateY}px)`,
      }}
    >
      {/* Eyebrow */}
      <div
        style={{
          opacity: labelOpacity,
          fontFamily: FONTS.INTER,
          fontSize: 22,
          fontWeight: 500,
          color: COLORS.mutedWhite,
          textTransform: 'uppercase',
          letterSpacing: '0.4em',
          marginBottom: 130,
        }}
      >
        By the Numbers
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 100,
          alignItems: 'center',
        }}
      >
        {STATS.map((s, i) => {
          const startFrame = 12 + i * 30;

          const opacity = interpolate(
            frame,
            [startFrame, startFrame + 21],
            [0, 1],
            {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
          );
          const ty = interpolate(
            frame,
            [startFrame, startFrame + 21],
            [28, 0],
            {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
          );

          /* Count up with ease-out cubic */
          const t = interpolate(
            frame,
            [startFrame, startFrame + 27],
            [0, 1],
            {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
          );
          const eased = 1 - Math.pow(1 - t, 3);
          const display = Math.round(s.finalValue * eased);

          return (
            <div
              key={s.label}
              style={{
                position: 'relative',
                opacity,
                transform: `translateY(${ty}px)`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 18,
              }}
            >
              {s.glow ? (
                <div
                  style={{
                    position: 'absolute',
                    width: 700,
                    height: 700,
                    borderRadius: '50%',
                    background: `radial-gradient(circle, rgba(45,107,228,${glowOpacity}) 0%, rgba(45,107,228,0) 65%)`,
                    top: -220,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    filter: 'blur(50px)',
                    pointerEvents: 'none',
                    zIndex: 0,
                  }}
                />
              ) : null}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 14,
                  zIndex: 1,
                }}
              >
                <span
                  style={{
                    fontFamily: FONTS.BARLOW,
                    fontWeight: 700,
                    fontSize: 220,
                    color: COLORS.white,
                    lineHeight: 0.9,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {display}
                </span>
                {s.unit ? (
                  <span
                    style={{
                      fontFamily: FONTS.BARLOW,
                      fontWeight: 700,
                      fontSize: 72,
                      color: COLORS.white,
                      textTransform: 'uppercase',
                      lineHeight: 0.9,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {s.unit}
                  </span>
                ) : null}
              </div>
              <span
                style={{
                  fontFamily: FONTS.INTER,
                  fontSize: 24,
                  color: COLORS.mutedWhite,
                  letterSpacing: '0.02em',
                  zIndex: 1,
                }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
