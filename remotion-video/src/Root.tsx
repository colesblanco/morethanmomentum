import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {AutomationDemo} from './AutomationDemo';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AutomationDemo"
        component={AutomationDemo}
        durationInFrames={817}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};

registerRoot(RemotionRoot);
