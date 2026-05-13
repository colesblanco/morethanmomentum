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

export const Scene06: React.FC<Props> = ({sceneDuration}) => {
  const rawFrame = useCurrentFrame();
  // Shift internal animations by 15f so they begin after the entrance transition completes.
  const frame = Math.max(0, rawFrame - 15);
  const {fps} = useVideoConfig();
  // fadeOnExit: false — the existing finalFade already drops content to black,
  // so the cross-scene exit only contributes the upward slide.
  const transition = getSceneTransition(rawFrame, sceneDuration, {fadeOnExit: false});

  /* Mirror Scene 1 timings */
  const logoOpacity = interpolate(frame, [0, 22], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const logoSpring = spring({frame, fps, config: SPRING_DEFAULT});
  const logoScale = interpolate(logoSpring, [0, 1], [0.85, 1]);

  const lineWidth = interpolate(frame, [18, 33], [0, 70], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const wordOpacity = interpolate(frame, [27, 45], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const wordTY = interpolate(frame, [27, 45], [20, 0], {
    extrapolateRight: 'clamp',
  });

  const tagOpacity = interpolate(frame, [39, 57], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const tagTY = interpolate(frame, [39, 57], [14, 0], {
    extrapolateRight: 'clamp',
  });

  /* GET STARTED button — springs in (54–75) */
  const buttonSpring = spring({
    frame: frame - 54,
    fps,
    config: SPRING_DEFAULT,
  });
  const buttonOpacity = interpolate(frame, [54, 72], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const buttonScale = interpolate(buttonSpring, [0, 1], [0.85, 1]);

  /* URL — fades in last (66–81) */
  const urlOpacity = interpolate(frame, [66, 81], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  /* URL holds fully visible from frame 81 to 111, then 9-frame fade to pure black (111–120) */
  const finalFade = interpolate(frame, [111, 120], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.deepBlack,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 150,
        opacity: transition.opacity,
        transform: `translateY(${transition.translateY}px)`,
      }}
    >
      <div
        style={{
          opacity: finalFade,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
            marginBottom: 56,
          }}
        >
          <RunningMan size={620} color={COLORS.white} />
        </div>

        <div
          style={{
            width: lineWidth,
            height: 3,
            background: COLORS.powerBlue,
            borderRadius: 2,
            boxShadow: `0 0 16px ${COLORS.powerBlue}`,
            marginBottom: 42,
          }}
        />

        <div
          style={{
            opacity: wordOpacity,
            transform: `translateY(${wordTY}px)`,
            fontFamily: FONTS.BARLOW,
            fontWeight: 700,
            fontSize: 92,
            color: COLORS.white,
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            lineHeight: 0.95,
            textAlign: 'center',
            marginBottom: 50,
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
            fontSize: 44,
            color: COLORS.white,
            marginBottom: 64,
          }}
        >
          Ready to build yours?
        </div>

        <div
          style={{
            opacity: buttonOpacity,
            transform: `scale(${buttonScale})`,
            background: COLORS.powerBlue,
            padding: '26px 56px',
            borderRadius: 14,
            fontFamily: FONTS.INTER,
            fontSize: 24,
            fontWeight: 700,
            color: COLORS.white,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            boxShadow: '0 18px 50px rgba(45,107,228,0.42)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          Get Started <span>→</span>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 140,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          opacity: urlOpacity * finalFade,
        }}
      >
        <span
          style={{
            width: 50,
            height: 2,
            background: COLORS.faintWhite,
          }}
        />
        <span
          style={{
            fontFamily: FONTS.INTER,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: '0.32em',
            color: COLORS.mutedWhite,
            textTransform: 'uppercase',
          }}
        >
          morethanmomentum.com
        </span>
        <span
          style={{
            width: 50,
            height: 2,
            background: COLORS.faintWhite,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
