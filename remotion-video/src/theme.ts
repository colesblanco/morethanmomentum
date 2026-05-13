import {loadFont as loadBarlow} from '@remotion/google-fonts/BarlowCondensed';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadCormorant} from '@remotion/google-fonts/CormorantGaramond';

const barlow = loadBarlow('normal', {weights: ['400', '600', '700']});
const inter = loadInter('normal', {weights: ['400', '500', '600', '700']});
const cormorantItalic = loadCormorant('italic', {weights: ['400', '500', '600']});

export const FONTS = {
  BARLOW: `${barlow.fontFamily}, 'Barlow Condensed', sans-serif`,
  INTER: `${inter.fontFamily}, 'Inter', system-ui, sans-serif`,
  CORMORANT: `${cormorantItalic.fontFamily}, 'Cormorant Garamond', Georgia, serif`,
};

export const COLORS = {
  deepBlack: '#0C0C0C',
  richDark: '#1A1A1A',
  cardBorder: '#2A2A2A',
  powerBlue: '#2D6BE4',
  electricBlue: '#5B8FF0',
  victoryYellow: '#F5C518',
  offWhite: '#F4F4F2',
  white: '#FFFFFF',
  mutedWhite: 'rgba(255, 255, 255, 0.65)',
  faintWhite: 'rgba(255, 255, 255, 0.4)',
};

export const SPRING_DEFAULT = {
  damping: 12,
  mass: 0.5,
};
