import {interpolate} from 'remotion';

/* Shared cross-scene transition.
 *
 * Each scene wraps its outer container with:
 *   opacity:   transition.opacity
 *   transform: translateY(transition.translateY)
 *
 * Entrance window (first 15 frames): opacity 0 → 1, translateY 30 → 0.
 * Exit window  (last  15 frames):    opacity 1 → 0, translateY 0 → -30.
 *
 * Consecutive Sequences are overlapped by 15 frames in AutomationDemo.tsx so
 * the exit of scene N and the entrance of scene N+1 run on the same frames —
 * giving a true cross-fade rather than a sequential cut.
 */

export type SceneTransitionResult = {
  opacity: number;
  translateY: number;
};

export type SceneTransitionOptions = {
  /**
   * When false, the wrapper opacity stays at 1 during the exit window
   * (only the upward slide is applied). Used by Scene 06, whose inner
   * `finalFade` already takes the content to black — a second wrapper
   * fade on top would be redundant.
   */
  fadeOnExit?: boolean;
};

export const TRANSITION_FRAMES = 15;

export const getSceneTransition = (
  rawFrame: number,
  sceneDuration: number,
  options: SceneTransitionOptions = {}
): SceneTransitionResult => {
  const {fadeOnExit = true} = options;

  const entranceOpacity = interpolate(rawFrame, [0, TRANSITION_FRAMES], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const entranceTY = interpolate(rawFrame, [0, TRANSITION_FRAMES], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const exitStart = sceneDuration - TRANSITION_FRAMES;
  const exitOpacity = fadeOnExit
    ? interpolate(rawFrame, [exitStart, sceneDuration], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  const exitTY = interpolate(rawFrame, [exitStart, sceneDuration], [0, -30], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return {
    opacity: entranceOpacity * exitOpacity,
    translateY: entranceTY + exitTY,
  };
};
