import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {COLORS, FONTS, SPRING_DEFAULT} from '../theme';
import {getSceneTransition} from '../transitions';

const HEADLINE_WORDS = ['Booked.', 'Automatically.'];
const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DATES = [23, 24, 25, 26, 27, 28, 29];

type Props = {
  sceneDuration: number;
};

export const Scene04: React.FC<Props> = ({sceneDuration}) => {
  const rawFrame = useCurrentFrame();
  // Shift internal animations by 15f so they begin after the entrance transition completes.
  const frame = Math.max(0, rawFrame - 15);
  const {fps} = useVideoConfig();
  const transition = getSceneTransition(rawFrame, sceneDuration);

  /* Headline — each word fades up 6 frames apart */
  const wordStyle = (i: number) => {
    const op = interpolate(frame, [i * 6, 21 + i * 6], [0, 1], {
      extrapolateRight: 'clamp',
    });
    const ty = interpolate(frame, [i * 6, 21 + i * 6], [16, 0], {
      extrapolateRight: 'clamp',
    });
    return {opacity: op, transform: `translateY(${ty}px)`};
  };

  /* Accent line beneath headline (24–39) */
  const accentWidth = interpolate(frame, [24, 39], [0, 90], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  /* Calendar fades in (30–48) */
  const calOpacity = interpolate(frame, [30, 48], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const calTY = interpolate(frame, [30, 48], [22, 0], {
    extrapolateRight: 'clamp',
  });

  /* Thursday 26 highlight pulse */
  const highlightSpring = spring({
    frame: frame - 42,
    fps,
    config: SPRING_DEFAULT,
  });
  const highlightScale = interpolate(highlightSpring, [0, 1], [0.85, 1]);
  /* Subtle continuous scale pulse on the highlight cell */
  const pulse =
    Math.sin(((frame - 48) / 45) * Math.PI * 2) *
    (frame > 48 ? 1 : 0);
  const highlightExtra = 1 + pulse * 0.025;

  /* 2:00 PM row slides in highlighted (51–69) */
  const rowSpring = spring({
    frame: frame - 51,
    fps,
    config: SPRING_DEFAULT,
  });
  const rowOpacity = interpolate(frame, [51, 66], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rowTX = interpolate(rowSpring, [0, 1], [180, 0]);

  /* Checkmark springs in last (66–81) */
  const checkSpring = spring({
    frame: frame - 66,
    fps,
    config: {damping: 10, mass: 0.4},
  });
  const checkScale = interpolate(checkSpring, [0, 1], [0, 1]);

  /* Yellow pill (78–90) */
  const pillOpacity = interpolate(frame, [78, 90], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const pillTY = interpolate(frame, [78, 90], [10, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.deepBlack,
        alignItems: 'center',
        paddingTop: 180,
        opacity: transition.opacity,
        transform: `translateY(${transition.translateY}px)`,
      }}
    >
      {/* Headline */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          lineHeight: 0.95,
        }}
      >
        {HEADLINE_WORDS.map((w, i) => (
          <div
            key={w}
            style={{
              fontFamily: FONTS.BARLOW,
              fontWeight: 700,
              fontSize: 132,
              color: COLORS.white,
              textTransform: 'uppercase',
              letterSpacing: '0.01em',
              ...wordStyle(i),
            }}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Accent line */}
      <div
        style={{
          width: accentWidth,
          height: 3,
          background: COLORS.powerBlue,
          borderRadius: 2,
          marginTop: 40,
        }}
      />

      {/* Calendar widget */}
      <div
        style={{
          marginTop: 56,
          opacity: calOpacity,
          transform: `translateY(${calTY}px)`,
          width: 900,
          background: COLORS.richDark,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 18,
          padding: 38,
        }}
      >
        {/* Calendar header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 30,
          }}
        >
          <div style={{display: 'flex', alignItems: 'baseline', gap: 14}}>
            <span
              style={{
                fontFamily: FONTS.BARLOW,
                fontWeight: 700,
                fontSize: 38,
                color: COLORS.white,
                textTransform: 'uppercase',
                letterSpacing: '0.01em',
              }}
            >
              March
            </span>
            <span
              style={{
                fontFamily: FONTS.CORMORANT,
                fontStyle: 'italic',
                fontWeight: 500,
                fontSize: 32,
                color: COLORS.powerBlue,
              }}
            >
              2026
            </span>
          </div>
          <span
            style={{
              fontFamily: FONTS.INTER,
              fontSize: 14,
              fontWeight: 500,
              color: COLORS.faintWhite,
              textTransform: 'uppercase',
              letterSpacing: '0.22em',
            }}
          >
            Discovery Calls
          </span>
        </div>

        {/* Day labels */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 10,
            marginBottom: 14,
          }}
        >
          {DAY_LABELS.map((d) => (
            <div
              key={d}
              style={{
                textAlign: 'center',
                fontFamily: FONTS.INTER,
                fontSize: 13,
                fontWeight: 600,
                color: COLORS.faintWhite,
                letterSpacing: '0.18em',
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Date cells */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 10,
            marginBottom: 30,
          }}
        >
          {DATES.map((d) => {
            const isHighlight = d === 26;
            return (
              <div
                key={d}
                style={{
                  height: 64,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONTS.BARLOW,
                  fontWeight: 700,
                  fontSize: 30,
                  color: isHighlight ? COLORS.white : COLORS.mutedWhite,
                  background: isHighlight ? COLORS.powerBlue : 'transparent',
                  transform: isHighlight
                    ? `scale(${highlightScale * highlightExtra})`
                    : 'scale(1)',
                  boxShadow: isHighlight
                    ? '0 0 32px rgba(45,107,228,0.55)'
                    : 'none',
                }}
              >
                {d}
              </div>
            );
          })}
        </div>

        {/* Time slot rows */}
        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
          {[
            {time: '11:00 AM', label: 'Available', highlight: false},
            {
              time: '2:00 PM',
              label: 'Discovery Call · Maria Alvarez',
              highlight: true,
            },
            {time: '4:30 PM', label: 'Available', highlight: false},
          ].map((row) => {
            const isHighlight = row.highlight;
            const opacity = isHighlight ? rowOpacity : 1;
            const tx = isHighlight ? rowTX : 0;
            return (
              <div
                key={row.time}
                style={{
                  opacity,
                  transform: `translateX(${tx}px)`,
                  background: isHighlight ? COLORS.powerBlue : '#0e0e0e',
                  borderRadius: 10,
                  padding: '20px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 30,
                  position: 'relative',
                  boxShadow: isHighlight
                    ? '0 16px 36px rgba(45,107,228,0.35)'
                    : 'none',
                }}
              >
                <span
                  style={{
                    fontFamily: FONTS.BARLOW,
                    fontWeight: 700,
                    fontSize: 28,
                    color: COLORS.white,
                    minWidth: 140,
                    letterSpacing: '0.02em',
                  }}
                >
                  {row.time}
                </span>
                <span
                  style={{
                    fontFamily: FONTS.INTER,
                    fontSize: 19,
                    color: isHighlight
                      ? 'rgba(255,255,255,0.92)'
                      : COLORS.mutedWhite,
                    flex: 1,
                  }}
                >
                  {row.label}
                </span>
                {isHighlight ? (
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      background: COLORS.white,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transform: `scale(${checkScale})`,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: FONTS.INTER,
                        fontWeight: 700,
                        fontSize: 20,
                        color: COLORS.powerBlue,
                        lineHeight: 1,
                      }}
                    >
                      ✓
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* "NO MANUAL EFFORT" pill */}
      <div
        style={{
          marginTop: 54,
          opacity: pillOpacity,
          transform: `translateY(${pillTY}px)`,
          background: COLORS.victoryYellow,
          padding: '14px 28px',
          fontFamily: FONTS.BARLOW,
          fontWeight: 700,
          fontSize: 22,
          color: COLORS.deepBlack,
          textTransform: 'uppercase',
          letterSpacing: '0.16em',
          borderRadius: 4,
          boxShadow: '0 14px 30px rgba(245,197,24,0.25)',
        }}
      >
        No Manual Effort
      </div>
    </AbsoluteFill>
  );
};
