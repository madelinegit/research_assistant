/**
 * Minimal theme tokens shared across screens. Adapts to light/dark via the
 * caller passing the current scheme; keeps styling consistent without a UI lib.
 */
export interface Theme {
  bg: string;
  surface: string;
  text: string;
  subtle: string;
  border: string;
  userBubble: string;
  userText: string;
  botBubble: string;
  botText: string;
  accent: string;
  warnBg: string;
  warnText: string;
  errorBg: string;
  errorText: string;
  meterTrack: string;
  meterFill: string;
  meterFillWarn: string;
}

const light: Theme = {
  bg: '#ffffff',
  surface: '#f5f5f7',
  text: '#111114',
  subtle: '#6b6b70',
  border: '#e2e2e6',
  userBubble: '#0a84ff',
  userText: '#ffffff',
  botBubble: '#ececf0',
  botText: '#111114',
  accent: '#0a84ff',
  warnBg: '#fff4d6',
  warnText: '#7a5b00',
  errorBg: '#ffe0e0',
  errorText: '#8a1f1f',
  meterTrack: '#e2e2e6',
  meterFill: '#34c759',
  meterFillWarn: '#ff9500',
};

const dark: Theme = {
  bg: '#000000',
  surface: '#1c1c1e',
  text: '#f2f2f7',
  subtle: '#9a9aa0',
  border: '#2c2c2e',
  userBubble: '#0a84ff',
  userText: '#ffffff',
  botBubble: '#2c2c2e',
  botText: '#f2f2f7',
  accent: '#0a84ff',
  warnBg: '#3a2f00',
  warnText: '#ffd666',
  errorBg: '#3a1414',
  errorText: '#ff9a9a',
  meterTrack: '#2c2c2e',
  meterFill: '#30d158',
  meterFillWarn: '#ff9f0a',
};

export function getTheme(scheme: string | null | undefined): Theme {
  return scheme === 'dark' ? dark : light;
}
