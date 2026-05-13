import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {COLORS} from './theme';
import {Scene01} from './scenes/Scene01';
import {Scene02} from './scenes/Scene02';
import {Scene03} from './scenes/Scene03';
import {Scene04} from './scenes/Scene04';
import {Scene05} from './scenes/Scene05';
import {Scene06} from './scenes/Scene06';

/* Per-scene durations include 15f entrance + 15f exit transition windows
 * on top of the previous content + 30f hold. Consecutive Sequences overlap
 * by 15 frames so the exit of scene N cross-fades with the entrance of
 * scene N+1. Total composition length: 817 frames.
 */
const SCENE_DURATIONS = {
  scene01: 142,
  scene02: 147,
  scene03: 144,
  scene04: 150,
  scene05: 159,
  scene06: 150,
};

const TRANSITION_OVERLAP = 15;

/* `from` offsets accumulate: each scene starts (previous scene's end - 15). */
const SCENE_FROM = {
  scene01: 0,
  scene02: SCENE_DURATIONS.scene01 - TRANSITION_OVERLAP, // 127
  scene03: SCENE_DURATIONS.scene01 + SCENE_DURATIONS.scene02 - 2 * TRANSITION_OVERLAP, // 259
  scene04:
    SCENE_DURATIONS.scene01 +
    SCENE_DURATIONS.scene02 +
    SCENE_DURATIONS.scene03 -
    3 * TRANSITION_OVERLAP, // 388
  scene05:
    SCENE_DURATIONS.scene01 +
    SCENE_DURATIONS.scene02 +
    SCENE_DURATIONS.scene03 +
    SCENE_DURATIONS.scene04 -
    4 * TRANSITION_OVERLAP, // 523
  scene06:
    SCENE_DURATIONS.scene01 +
    SCENE_DURATIONS.scene02 +
    SCENE_DURATIONS.scene03 +
    SCENE_DURATIONS.scene04 +
    SCENE_DURATIONS.scene05 -
    5 * TRANSITION_OVERLAP, // 667
};

export const AutomationDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{backgroundColor: COLORS.deepBlack}}>
      <Sequence from={SCENE_FROM.scene01} durationInFrames={SCENE_DURATIONS.scene01}>
        <Scene01 sceneDuration={SCENE_DURATIONS.scene01} />
      </Sequence>
      <Sequence from={SCENE_FROM.scene02} durationInFrames={SCENE_DURATIONS.scene02}>
        <Scene02 sceneDuration={SCENE_DURATIONS.scene02} />
      </Sequence>
      <Sequence from={SCENE_FROM.scene03} durationInFrames={SCENE_DURATIONS.scene03}>
        <Scene03 sceneDuration={SCENE_DURATIONS.scene03} />
      </Sequence>
      <Sequence from={SCENE_FROM.scene04} durationInFrames={SCENE_DURATIONS.scene04}>
        <Scene04 sceneDuration={SCENE_DURATIONS.scene04} />
      </Sequence>
      <Sequence from={SCENE_FROM.scene05} durationInFrames={SCENE_DURATIONS.scene05}>
        <Scene05 sceneDuration={SCENE_DURATIONS.scene05} />
      </Sequence>
      <Sequence from={SCENE_FROM.scene06} durationInFrames={SCENE_DURATIONS.scene06}>
        <Scene06 sceneDuration={SCENE_DURATIONS.scene06} />
      </Sequence>
    </AbsoluteFill>
  );
};
