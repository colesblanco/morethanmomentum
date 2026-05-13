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

type Notification = {
  icon: string;
  iconColor: string;
  iconBg: string;
  title: string;
  desc: string;
  endTimestamp: number;
  suffix: string;
  offsetX: number;
};

const CARDS: Notification[] = [
  {
    icon: '⚡',
    iconColor: COLORS.victoryYellow,
    iconBg: 'rgba(245,197,24,0.08)',
    title: 'CRM Entry Created',
    desc: 'Contact, source, timestamp logged.',
    endTimestamp: 0,
    suffix: ':00',
    offsetX: -40,
  },
  {
    icon: '💬',
    iconColor: COLORS.electricBlue,
    iconBg: 'rgba(91,143,240,0.10)',
    title: 'SMS Sent in 60 Seconds',
    desc: 'Personalized. From a real number.',
    endTimestamp: 47,
    suffix: ':47',
    offsetX: 0,
  },
  {
    icon: '★',
    iconColor: COLORS.victoryYellow,
    iconBg: 'rgba(245,197,24,0.08)',
    title: 'Lead Scored: High Priority',
    desc: 'High-intent signal detected.',
    endTimestamp: 60,
    suffix: ':60',
    offsetX: 50,
  },
];

type Props = {
  sceneDuration: number;
};

export const Scene03: React.FC<Props> = ({sceneDuration}) => {
  const rawFrame = useCurrentFrame();
  // Shift internal animations by 15f so they begin after the entrance transition completes.
  const frame = Math.max(0, rawFrame - 15);
  const {fps} = useVideoConfig();
  const transition = getSceneTransition(rawFrame, sceneDuration);

  const labelOpacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.deepBlack,
        alignItems: 'center',
        paddingTop: 340,
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
          marginBottom: 90,
        }}
      >
        While You Were Busy
      </div>

      {/* Cards */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 38,
          width: '100%',
          padding: '0 80px',
        }}
      >
        {CARDS.map((card, i) => {
          const startFrame = 15 + i * 18;
          const cardSpring = spring({
            frame: frame - startFrame,
            fps,
            config: SPRING_DEFAULT,
          });
          const opacity = interpolate(
            frame - startFrame,
            [0, 15],
            [0, 1],
            {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
          );
          const translateX =
            interpolate(cardSpring, [0, 1], [800, 0]) + card.offsetX;

          /* Timestamp counts up to its final value over 12 frames */
          const tsStart = startFrame + 21;
          const tsProgress = interpolate(
            frame - tsStart,
            [0, 12],
            [0, 1],
            {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
          );
          const tsValue = Math.round(card.endTimestamp * tsProgress);
          const tsText = `:${tsValue.toString().padStart(2, '0')}`;

          return (
            <div
              key={card.title}
              style={{
                opacity,
                transform: `translateX(${translateX}px)`,
                background: COLORS.richDark,
                borderLeft: `5px solid ${COLORS.powerBlue}`,
                borderRadius: 14,
                padding: '30px 36px',
                paddingRight: 110,
                display: 'flex',
                alignItems: 'center',
                gap: 26,
                boxShadow: '0 24px 50px rgba(0,0,0,0.5)',
                position: 'relative',
                minHeight: 140,
              }}
            >
              {/* Icon block */}
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 12,
                  background: card.iconBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 34,
                  color: card.iconColor,
                  flexShrink: 0,
                  lineHeight: 1,
                }}
              >
                {card.icon}
              </div>

              {/* Title + description */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: FONTS.BARLOW,
                    fontWeight: 700,
                    fontSize: 32,
                    color: COLORS.white,
                    textTransform: 'uppercase',
                    letterSpacing: '0.02em',
                    lineHeight: 1,
                  }}
                >
                  {card.title}
                </span>
                <span
                  style={{
                    fontFamily: FONTS.INTER,
                    fontSize: 18,
                    color: COLORS.mutedWhite,
                    lineHeight: 1.4,
                  }}
                >
                  {card.desc}
                </span>
              </div>

              {/* Faint corner mark (top-right) */}
              <div
                style={{
                  position: 'absolute',
                  top: 18,
                  right: 24,
                  color: 'rgba(255,255,255,0.18)',
                  fontSize: 18,
                  lineHeight: 1,
                }}
              >
                ✦
              </div>

              {/* Timestamp (bottom-right) */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 18,
                  right: 24,
                  fontFamily: FONTS.BARLOW,
                  fontWeight: 700,
                  fontSize: 28,
                  color: COLORS.powerBlue,
                  letterSpacing: '0.04em',
                  lineHeight: 1,
                }}
              >
                {tsText}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
