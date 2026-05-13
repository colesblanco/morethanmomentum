import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {COLORS, FONTS} from '../theme';
import {getSceneTransition} from '../transitions';

type Props = {
  sceneDuration: number;
};

export const Scene02: React.FC<Props> = ({sceneDuration}) => {
  const rawFrame = useCurrentFrame();
  // Shift internal animations by 15f so they begin after the entrance transition completes.
  const frame = Math.max(0, rawFrame - 15);
  const {fps} = useVideoConfig();
  const transition = getSceneTransition(rawFrame, sceneDuration);

  /* Top label */
  const labelOpacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: 'clamp',
  });

  /* Phone slides up — weighty spring (heavier than default) */
  const phoneSpring = spring({
    frame: frame - 6,
    fps,
    config: {damping: 16, mass: 1.4, stiffness: 80},
  });
  const phoneY = interpolate(phoneSpring, [0, 1], [1500, 0]);

  /* Form fields stagger after phone settles (start ~frame 39) */
  const fieldStart = 39;
  const fieldStagger = 6;
  const fieldStyle = (i: number) => {
    const op = interpolate(
      frame,
      [fieldStart + i * fieldStagger, fieldStart + 15 + i * fieldStagger],
      [0, 1],
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
    );
    const ty = interpolate(
      frame,
      [fieldStart + i * fieldStagger, fieldStart + 15 + i * fieldStagger],
      [8, 0],
      {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
    );
    return {opacity: op, transform: `translateY(${ty}px)`};
  };

  /* SEND REQUEST pulse — Power Blue glow loop */
  const pulsePhase = (frame % 54) / 54;
  const pulseGlow = 12 + Math.sin(pulsePhase * Math.PI * 2) * 14;

  /* At scene-frame 68 (= global 158): accent line draws + "Form submitted." fades in */
  const accentWidth = interpolate(frame, [68, 82], [0, 240], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const submittedOpacity = interpolate(frame, [75, 87], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const submittedTY = interpolate(frame, [75, 87], [10, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const PHONE_W = 600;
  const PHONE_H = 1230;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.deepBlack,
        alignItems: 'center',
        opacity: transition.opacity,
        transform: `translateY(${transition.translateY}px)`,
      }}
    >
      {/* Top eyebrow */}
      <div
        style={{
          marginTop: 130,
          opacity: labelOpacity,
          fontFamily: FONTS.INTER,
          fontSize: 22,
          fontWeight: 500,
          color: COLORS.mutedWhite,
          textTransform: 'uppercase',
          letterSpacing: '0.36em',
        }}
      >
        The Moment It Starts
      </div>

      {/* Phone */}
      <div
        style={{
          position: 'absolute',
          top: 240,
          left: '50%',
          width: PHONE_W,
          height: PHONE_H,
          transform: `translateX(-50%) translateY(${phoneY}px)`,
          borderRadius: 64,
          background: '#0a0a0a',
          padding: 14,
          boxShadow: '0 60px 120px rgba(0,0,0,0.6), 0 0 0 1.5px #2A2A2A',
        }}
      >
        {/* Screen */}
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: 50,
            background: '#FFFFFF',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Dynamic island */}
          <div
            style={{
              position: 'absolute',
              top: 22,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 130,
              height: 36,
              borderRadius: 18,
              background: '#000000',
            }}
          />

          {/* Status bar */}
          <div
            style={{
              position: 'absolute',
              top: 28,
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 40px',
            }}
          >
            <span
              style={{
                fontFamily: FONTS.INTER,
                fontSize: 22,
                fontWeight: 700,
                color: '#000',
              }}
            >
              9:41
            </span>
            <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
              {/* Signal dots */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'flex-end',
                  gap: 3,
                  height: 14,
                }}
              >
                <span style={{width: 4, height: 5, background: '#000', borderRadius: 1}} />
                <span style={{width: 4, height: 8, background: '#000', borderRadius: 1}} />
                <span style={{width: 4, height: 11, background: '#000', borderRadius: 1}} />
                <span style={{width: 4, height: 14, background: '#000', borderRadius: 1}} />
              </span>
              {/* Wifi (chevron-ish) */}
              <span
                style={{
                  width: 16,
                  height: 14,
                  background: '#000',
                  clipPath: 'polygon(0 60%, 50% 0, 100% 60%, 80% 80%, 50% 35%, 20% 80%)',
                }}
              />
              {/* Battery */}
              <span
                style={{
                  position: 'relative',
                  width: 30,
                  height: 14,
                  border: '1.5px solid #000',
                  borderRadius: 3,
                  padding: 1,
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    background: '#000',
                    borderRadius: 1,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    right: -4,
                    top: 4,
                    width: 2,
                    height: 6,
                    background: '#000',
                    borderRadius: 1,
                  }}
                />
              </span>
            </div>
          </div>

          {/* Form content */}
          <div
            style={{
              position: 'absolute',
              top: 120,
              left: 40,
              right: 40,
              display: 'flex',
              flexDirection: 'column',
              gap: 26,
            }}
          >
            {/* Header row */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                ...fieldStyle(-2),
              }}
            >
              <div
                style={{
                  fontFamily: FONTS.INTER,
                  fontSize: 16,
                  fontWeight: 700,
                  color: '#0c0c0c',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  lineHeight: 1.2,
                }}
              >
                Cedar Grove
                <br />
                Plumbing
              </div>
              {/* hamburger */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  marginTop: 6,
                }}
              >
                <span style={{width: 22, height: 2, background: '#0c0c0c'}} />
                <span style={{width: 22, height: 2, background: '#0c0c0c'}} />
                <span style={{width: 22, height: 2, background: '#0c0c0c'}} />
              </div>
            </div>

            {/* — FREE ESTIMATE */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginTop: 10,
                ...fieldStyle(-1),
              }}
            >
              <span style={{width: 18, height: 2, background: COLORS.powerBlue}} />
              <span
                style={{
                  fontFamily: FONTS.INTER,
                  fontSize: 13,
                  fontWeight: 700,
                  color: COLORS.powerBlue,
                  textTransform: 'uppercase',
                  letterSpacing: '0.18em',
                }}
              >
                Free Estimate
              </span>
            </div>

            {/* Heading */}
            <div style={{marginTop: 4, ...fieldStyle(0)}}>
              <div
                style={{
                  fontFamily: FONTS.BARLOW,
                  fontWeight: 700,
                  fontSize: 60,
                  color: '#0c0c0c',
                  textTransform: 'uppercase',
                  lineHeight: 1.0,
                  letterSpacing: '0.01em',
                }}
              >
                Tell us
                <br />
                what&apos;s{' '}
                <span
                  style={{
                    fontFamily: FONTS.CORMORANT,
                    fontStyle: 'italic',
                    fontWeight: 500,
                    textTransform: 'lowercase',
                    color: COLORS.powerBlue,
                  }}
                >
                  broken.
                </span>
              </div>
            </div>

            {/* Form fields */}
            {[
              {label: 'Name', value: 'Maria Alvarez', chevron: false},
              {label: 'Phone', value: '(512) 555-0118', chevron: false},
              {label: 'Service Needed', value: 'Leak repair · kitchen', chevron: true},
            ].map((f, i) => (
              <div
                key={f.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  ...fieldStyle(i + 1),
                }}
              >
                <span
                  style={{
                    fontFamily: FONTS.INTER,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#888',
                    textTransform: 'uppercase',
                    letterSpacing: '0.16em',
                  }}
                >
                  {f.label}
                </span>
                <div
                  style={{
                    borderBottom: '1px solid #DDDDDD',
                    paddingBottom: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span
                    style={{
                      fontFamily: FONTS.INTER,
                      fontSize: 22,
                      fontWeight: 500,
                      color: '#0c0c0c',
                    }}
                  >
                    {f.value}
                  </span>
                  {f.chevron ? (
                    <span
                      style={{
                        color: '#888',
                        fontSize: 20,
                        transform: 'rotate(90deg)',
                        lineHeight: 1,
                      }}
                    >
                      ›
                    </span>
                  ) : null}
                </div>
              </div>
            ))}

            {/* Send Request button */}
            <div
              style={{
                marginTop: 22,
                height: 80,
                borderRadius: 14,
                background: COLORS.powerBlue,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONTS.INTER,
                fontSize: 22,
                fontWeight: 700,
                color: COLORS.white,
                textTransform: 'uppercase',
                letterSpacing: '0.14em',
                boxShadow: `0 0 ${pulseGlow}px rgba(45,107,228,0.6), 0 18px 36px rgba(45,107,228,0.28)`,
                ...fieldStyle(4),
              }}
            >
              Send Request
              <span style={{marginLeft: 14}}>→</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: accent line + "Form submitted." */}
      <div
        style={{
          position: 'absolute',
          bottom: 110,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
        }}
      >
        <div
          style={{
            width: accentWidth,
            height: 2,
            background: COLORS.powerBlue,
          }}
        />
        <div
          style={{
            opacity: submittedOpacity,
            transform: `translateY(${submittedTY}px)`,
            fontFamily: FONTS.CORMORANT,
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 32,
            color: COLORS.white,
          }}
        >
          Form submitted.
        </div>
      </div>
    </AbsoluteFill>
  );
};
