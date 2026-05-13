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
import {RunningMan} from './RunningMan';

type Props = {
  sceneDuration: number;
};

export const Scene01: React.FC<Props> = ({sceneDuration}) => {
  const rawFrame = useCurrentFrame();
  // Shift internal animations by 15f so they begin after the entrance transition completes.
  const frame = Math.max(0, rawFrame - 15);
  const {fps} = useVideoConfig();
  const transition = getSceneTransition(rawFrame, sceneDuration);

  /* Logo — fade + slight scale spring over first 22 frames */
  const logoOpacity = interpolate(frame, [0, 22], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const logoSpring = spring({frame, fps, config: SPRING_DEFAULT});
  const logoScale = interpolate(logoSpring, [0, 1], [0.85, 1]);

  /* Accent line — draws horizontally from center outward (18–33) */
  const lineWidth = interpolate(frame, [18, 33], [0, 70], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  /* Wordmark — fades up with translateY 20→0 (27–45) */
  const wordOpacity = interpolate(frame, [27, 45], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const wordTY = interpolate(frame, [27, 45], [20, 0], {
    extrapolateRight: 'clamp',
  });

  /* Tagline — fades in 12f after wordmark (39–60) */
  const tagOpacity = interpolate(frame, [39, 60], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const tagTY = interpolate(frame, [39, 60], [14, 0], {
    extrapolateRight: 'clamp',
  });

  /* Bottom label — fades in last (60–82) */
  const bottomOpacity = interpolate(frame, [60, 82], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.deepBlack,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 300,
        opacity: transition.opacity,
        transform: `translateY(${transition.translateY}px)`,
      }}
    >
      {/* Main center group */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
            marginBottom: 70,
          }}
        >
          <RunningMan size={520} color={COLORS.white} />
        </div>

        <div
          style={{
            width: lineWidth,
            height: 3,
            background: COLORS.powerBlue,
            borderRadius: 2,
            boxShadow: `0 0 20px ${COLORS.powerBlue}`,
            marginBottom: 50,
          }}
        />

        <div
          style={{
            opacity: wordOpacity,
            transform: `translateY(${wordTY}px)`,
            fontFamily: FONTS.BARLOW,
            fontWeight: 700,
            fontSize: 110,
            color: COLORS.white,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            lineHeight: 0.95,
            textAlign: 'center',
            marginBottom: 80,
          }}
        >
          More Than
          <br />
          Momentum
        </div>

        <div
          style={{
            opacity: tagOpacity,
            transform: `translateY(${tagTY}px)`,
            fontFamily: FONTS.CORMORANT,
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 48,
            color: COLORS.white,
            textAlign: 'center',
            maxWidth: 780,
            lineHeight: 1.25,
            padding: '0 80px',
          }}
        >
          What happens when a lead comes in?
        </div>
      </div>

      {/* Bottom — accent line above caption */}
      <div
        style={{
          position: 'absolute',
          bottom: 160,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          opacity: bottomOpacity,
        }}
      >
        <div
          style={{
            width: 50,
            height: 2,
            background: COLORS.powerBlue,
          }}
        />
        <span
          style={{
            fontFamily: FONTS.INTER,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: '0.38em',
            color: COLORS.mutedWhite,
            textTransform: 'uppercase',
          }}
        >
          A 60-Second Look
        </span>
      </div>
    </AbsoluteFill>
  );
};
