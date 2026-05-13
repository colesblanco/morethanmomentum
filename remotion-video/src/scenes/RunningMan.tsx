import React from 'react';
import {Img, staticFile} from 'remotion';

type Props = {
  size?: number;
  /**
   * Retained for API compatibility with the previous SVG-based implementation.
   * Has no visual effect now that the logo is a PNG asset.
   */
  color?: string;
};

export const RunningMan: React.FC<Props> = ({size = 400}) => {
  return (
    <Img
      src={staticFile('mtm-logo.png')}
      style={{
        width: size,
        height: 'auto',
        display: 'block',
      }}
      alt="More Than Momentum logo"
    />
  );
};
