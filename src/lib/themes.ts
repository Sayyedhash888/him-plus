export type ThemeId =
  | 'onyx'
  | 'graphite'
  | 'light'
  | 'marimo'
  | 'midnight'
  | 'terminal'
  | 'sandstone';

export type ThemeMode = 'dark' | 'light';

export interface ThemeColors {
  ink950: string;
  ink900: string;
  ink850: string;
  ink800: string;
  ink750: string;
  ink700: string;
  ink650: string;
  line: string;
  lineStrong: string;
  lineFaint: string;
  mistBright: string;
  mist: string;
  mistDim: string;
  mistFaint: string;
  mistGhost: string;
  accent: string;
  accentSoft: string;
  accentDim: string;
  accentDeep: string;
  mint: string;
  mintSoft: string;
  mintDim: string;
  mintDeep: string;
  coral: string;
  coralSoft: string;
  coralDim: string;
  coralDeep: string;
  sand: string;
  sandSoft: string;
  sandDim: string;
  sandDeep: string;
  azure: string;
  azureSoft: string;
  azureDim: string;
  azureDeep: string;
}

export interface EditorPalette {
  background: string;
  foreground: string;
  lineHighlight: string;
  lineNumber: string;
  lineNumberActive: string;
  selection: string;
  inactiveSelection: string;
  widgetBackground: string;
  widgetBorder: string;
  cursor: string;
  syntax: {
    comment: string;
    keyword: string;
    string: string;
    number: string;
    type: string;
    functionName: string;
    variable: string;
    operator: string;
    tag: string;
    attribute: string;
    invalid: string;
  };
}

export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
}

export interface AppTheme {
  id: ThemeId;
  name: string;
  blurb: string;
  mode: ThemeMode;
  tag?: string;
  colors: ThemeColors;
  editor: EditorPalette;
  terminal: TerminalPalette;
  atmosphere: { accent: number; secondary: number };
  scrollbar: { thumb: string; hover: string };
}

const onyx: AppTheme = {
  id: 'onyx',
  name: 'Black',
  blurb: 'True black, bone accent, maximum contrast.',
  mode: 'dark',
  colors: {
    ink950: '#050505',
    ink900: '#080808',
    ink850: '#0C0C0C',
    ink800: '#111110',
    ink750: '#171614',
    ink700: '#1D1C19',
    ink650: '#25231F',
    line: '#24221E',
    lineStrong: '#34312B',
    lineFaint: '#141310',
    mistBright: '#F2EFE8',
    mist: '#B7B3AA',
    mistDim: '#8A867D',
    mistFaint: '#66635C',
    mistGhost: '#45433E',
    accent: '#E8E2D6',
    accentSoft: '#FFFDF7',
    accentDim: '#6A655A',
    accentDeep: '#28251F',
    mint: '#9DC7A5',
    mintSoft: '#D3EBD8',
    mintDim: '#4A7053',
    mintDeep: '#142519',
    coral: '#D98B8B',
    coralSoft: '#F1C2C2',
    coralDim: '#744040',
    coralDeep: '#291414',
    sand: '#CDBD8C',
    sandSoft: '#EADFBD',
    sandDim: '#6C5F37',
    sandDeep: '#272313',
    azure: '#A7B6C6',
    azureSoft: '#D6E1EA',
    azureDim: '#51606F',
    azureDeep: '#19212A',
  },
  editor: {
    background: '#080808',
    foreground: '#DCD8CF',
    lineHighlight: '#0E0D0B',
    lineNumber: '#3C3A35',
    lineNumberActive: '#8A867D',
    selection: '#2B2A25',
    inactiveSelection: '#211F1B',
    widgetBackground: '#111110',
    widgetBorder: '#2A2822',
    cursor: '#E8E2D6',
    syntax: {
      comment: '#625F58',
      keyword: '#C3CCD4',
      string: '#B3C3A1',
      number: '#CDBD8C',
      type: '#C8D2D8',
      functionName: '#E5DECF',
      variable: '#DEDAD1',
      operator: '#9A958C',
      tag: '#C3CCD4',
      attribute: '#CDBD8C',
      invalid: '#D98B8B',
    },
  },
  terminal: {
    background: '#050505',
    foreground: '#D8D4CB',
    cursor: '#E8E2D6',
    selection: '#2B2A25',
  },
  atmosphere: { accent: 0.035, secondary: 0.012 },
  scrollbar: { thumb: '#292722', hover: '#3A3731' },
};

const graphite: AppTheme = {
  id: 'graphite',
  name: 'Dark Grey',
  blurb: 'Neutral charcoal with a quiet steel accent.',
  mode: 'dark',
  colors: {
    ink950: '#0C0D0F',
    ink900: '#131416',
    ink850: '#181A1D',
    ink800: '#1D2024',
    ink750: '#24272C',
    ink700: '#2B2F34',
    ink650: '#33383E',
    line: '#2B2F34',
    lineStrong: '#3B4148',
    lineFaint: '#1E2124',
    mistBright: '#E8EAEC',
    mist: '#B4B8BD',
    mistDim: '#8C9198',
    mistFaint: '#686E75',
    mistGhost: '#484E55',
    accent: '#B5C0CA',
    accentSoft: '#E4E9EE',
    accentDim: '#616D78',
    accentDeep: '#20262C',
    mint: '#90BE9E',
    mintSoft: '#C9E4D0',
    mintDim: '#476E52',
    mintDeep: '#14241A',
    coral: '#D38F8F',
    coralSoft: '#EFC1C1',
    coralDim: '#6F3E3E',
    coralDeep: '#281414',
    sand: '#C9BA8E',
    sandSoft: '#E8DEBF',
    sandDim: '#685D3A',
    sandDeep: '#272314',
    azure: '#9BB8CC',
    azureSoft: '#CFE1EC',
    azureDim: '#4E6576',
    azureDeep: '#18232B',
  },
  editor: {
    background: '#131416',
    foreground: '#DADDE0',
    lineHighlight: '#191B1E',
    lineNumber: '#3E434A',
    lineNumberActive: '#8C9198',
    selection: '#2A3139',
    inactiveSelection: '#20252A',
    widgetBackground: '#1D2024',
    widgetBorder: '#343A41',
    cursor: '#B5C0CA',
    syntax: {
      comment: '#666D74',
      keyword: '#A7B9C7',
      string: '#A9C1A3',
      number: '#C9BA8E',
      type: '#B5C9D8',
      functionName: '#D6DFE6',
      variable: '#DADDE0',
      operator: '#939AA1',
      tag: '#A7B9C7',
      attribute: '#C9BA8E',
      invalid: '#D38F8F',
    },
  },
  terminal: {
    background: '#0C0D0F',
    foreground: '#D4D7DA',
    cursor: '#B5C0CA',
    selection: '#2A3139',
  },
  atmosphere: { accent: 0.028, secondary: 0.01 },
  scrollbar: { thumb: '#30353B', hover: '#41484F' },
};

const light: AppTheme = {
  id: 'light',
  name: 'Light',
  blurb: 'Warm white paper with an ink accent.',
  mode: 'light',
  colors: {
    ink950: '#FFFFFF',
    ink900: '#F5F3EE',
    ink850: '#FAF8F3',
    ink800: '#FFFFFF',
    ink750: '#EEEAE1',
    ink700: '#E5E1D6',
    ink650: '#D9D4C7',
    line: '#D9D3C6',
    lineStrong: '#C3BCAB',
    lineFaint: '#EBE6DB',
    mistBright: '#1C1A15',
    mist: '#3B3830',
    mistDim: '#676256',
    mistFaint: '#827C6F',
    mistGhost: '#A8A296',
    accent: '#1E1C17',
    accentSoft: '#000000',
    accentDim: '#756F63',
    accentDeep: '#E6E1D5',
    mint: '#2C7A4C',
    mintSoft: '#1C5633',
    mintDim: '#94C7A7',
    mintDeep: '#DFF0E4',
    coral: '#A84444',
    coralSoft: '#7F2C2C',
    coralDim: '#E1B3B3',
    coralDeep: '#F7E5E2',
    sand: '#79631F',
    sandSoft: '#5A4810',
    sandDim: '#D4C58D',
    sandDeep: '#F5EFDA',
    azure: '#2B5F7B',
    azureSoft: '#1C465E',
    azureDim: '#A6C4D7',
    azureDeep: '#E4EFF5',
  },
  editor: {
    background: '#FFFFFF',
    foreground: '#2C2A24',
    lineHighlight: '#F7F4EC',
    lineNumber: '#A7A092',
    lineNumberActive: '#6A6558',
    selection: '#E7EBE3',
    inactiveSelection: '#F0EDE5',
    widgetBackground: '#FFFFFF',
    widgetBorder: '#D9D3C6',
    cursor: '#1E1C17',
    syntax: {
      comment: '#90897B',
      keyword: '#2F5A78',
      string: '#406B50',
      number: '#79631F',
      type: '#356A72',
      functionName: '#315D76',
      variable: '#2C2A24',
      operator: '#625D52',
      tag: '#2F5A78',
      attribute: '#79631F',
      invalid: '#A84444',
    },
  },
  terminal: {
    background: '#FBFAF6',
    foreground: '#3B3830',
    cursor: '#1E1C17',
    selection: '#E5E1D6',
  },
  atmosphere: { accent: 0.018, secondary: 0.008 },
  scrollbar: { thumb: '#CBC5B8', hover: '#B8B1A2' },
};

const marimo: AppTheme = {
  id: 'marimo',
  name: 'Marimo',
  blurb: 'Cream notebook paper, moss ink, MNL character.',
  mode: 'light',
  tag: 'MNL',
  colors: {
    ink950: '#FEFCF6',
    ink900: '#F6F2E7',
    ink850: '#FBF8EF',
    ink800: '#FFFDF8',
    ink750: '#EFE9DB',
    ink700: '#E6DECB',
    ink650: '#DAD0BA',
    line: '#D8D0BF',
    lineStrong: '#C1B7A3',
    lineFaint: '#E9E1D2',
    mistBright: '#1E2B24',
    mist: '#3E4A42',
    mistDim: '#6A746C',
    mistFaint: '#858D85',
    mistGhost: '#A9B0A7',
    accent: '#1F6B51',
    accentSoft: '#144937',
    accentDim: '#88AE9D',
    accentDeep: '#DFEDE4',
    mint: '#2E7B57',
    mintSoft: '#205B40',
    mintDim: '#A1CBB5',
    mintDeep: '#E2F0E7',
    coral: '#A74F47',
    coralSoft: '#7E352F',
    coralDim: '#E2B5B0',
    coralDeep: '#F8E8E5',
    sand: '#7A6828',
    sandSoft: '#5A4B15',
    sandDim: '#D7CB9C',
    sandDeep: '#F5F0DB',
    azure: '#336A7B',
    azureSoft: '#24505F',
    azureDim: '#A6C5D0',
    azureDeep: '#E3EEF2',
  },
  editor: {
    background: '#FFFDF8',
    foreground: '#27332C',
    lineHighlight: '#F6F1E5',
    lineNumber: '#A9A090',
    lineNumberActive: '#6D756C',
    selection: '#E2EBE5',
    inactiveSelection: '#F3EEE2',
    widgetBackground: '#FFFDF8',
    widgetBorder: '#D8D0BF',
    cursor: '#1F6B51',
    syntax: {
      comment: '#8C8778',
      keyword: '#2D6553',
      string: '#66662E',
      number: '#7A6828',
      type: '#336A7B',
      functionName: '#205B44',
      variable: '#27332C',
      operator: '#6D675B',
      tag: '#2D6553',
      attribute: '#7A6828',
      invalid: '#A74F47',
    },
  },
  terminal: {
    background: '#FEFCF6',
    foreground: '#39453D',
    cursor: '#1F6B51',
    selection: '#E2EBE5',
  },
  atmosphere: { accent: 0.03, secondary: 0.012 },
  scrollbar: { thumb: '#D2C9B7', hover: '#C1B7A2' },
};

const midnight: AppTheme = {
  id: 'midnight',
  name: 'Midnight',
  blurb: 'Deep navy with a cool steel-blue edge.',
  mode: 'dark',
  colors: {
    ink950: '#060B12',
    ink900: '#0A111B',
    ink850: '#0E1722',
    ink800: '#121D2A',
    ink750: '#172433',
    ink700: '#1D2C3D',
    ink650: '#243548',
    line: '#1D2C3D',
    lineStrong: '#2D4054',
    lineFaint: '#101A25',
    mistBright: '#E1EBF4',
    mist: '#ADBECD',
    mistDim: '#8195A7',
    mistFaint: '#5F7284',
    mistGhost: '#405263',
    accent: '#7EB3D4',
    accentSoft: '#BCDCEF',
    accentDim: '#4D7590',
    accentDeep: '#162B3A',
    mint: '#77C6A9',
    mintSoft: '#B6E7D6',
    mintDim: '#3B7562',
    mintDeep: '#102B23',
    coral: '#DB9595',
    coralSoft: '#F2C5C5',
    coralDim: '#6E4141',
    coralDeep: '#281515',
    sand: '#CBBB8D',
    sandSoft: '#E7DCBB',
    sandDim: '#665C3A',
    sandDeep: '#252211',
    azure: '#99C4E2',
    azureSoft: '#CDE5F5',
    azureDim: '#4C6E86',
    azureDeep: '#16252F',
  },
  editor: {
    background: '#0A111B',
    foreground: '#D6E2EE',
    lineHighlight: '#0F1924',
    lineNumber: '#35475A',
    lineNumberActive: '#8195A7',
    selection: '#1C3245',
    inactiveSelection: '#142431',
    widgetBackground: '#121D2A',
    widgetBorder: '#2B3D50',
    cursor: '#7EB3D4',
    syntax: {
      comment: '#5E7284',
      keyword: '#8DBEE0',
      string: '#9FC9AE',
      number: '#CBBB8D',
      type: '#A8CBE1',
      functionName: '#D2E2F0',
      variable: '#D6E2EE',
      operator: '#8A9EAF',
      tag: '#8DBEE0',
      attribute: '#CBBB8D',
      invalid: '#DB9595',
    },
  },
  terminal: {
    background: '#060B12',
    foreground: '#CFDDE9',
    cursor: '#7EB3D4',
    selection: '#1C3245',
  },
  atmosphere: { accent: 0.045, secondary: 0.014 },
  scrollbar: { thumb: '#253547', hover: '#354A5E' },
};

const terminal: AppTheme = {
  id: 'terminal',
  name: 'Terminal',
  blurb: 'Pitch black with phosphor green.',
  mode: 'dark',
  colors: {
    ink950: '#020403',
    ink900: '#050806',
    ink850: '#080D0A',
    ink800: '#0B120E',
    ink750: '#101A13',
    ink700: '#17251B',
    ink650: '#1E3024',
    line: '#192A20',
    lineStrong: '#273D2F',
    lineFaint: '#0C1510',
    mistBright: '#D7EEDA',
    mist: '#A8C3AC',
    mistDim: '#7A987F',
    mistFaint: '#5A7360',
    mistGhost: '#3D5141',
    accent: '#5CCF8D',
    accentSoft: '#9EE8BB',
    accentDim: '#326B4A',
    accentDeep: '#0D2A1B',
    mint: '#5CCF8D',
    mintSoft: '#9EE8BB',
    mintDim: '#326B4A',
    mintDeep: '#0D2A1B',
    coral: '#DC8A8A',
    coralSoft: '#F1BDBD',
    coralDim: '#713F3F',
    coralDeep: '#291313',
    sand: '#D2BF83',
    sandSoft: '#E8DDB7',
    sandDim: '#685E36',
    sandDeep: '#252212',
    azure: '#95C2D0',
    azureSoft: '#CAE4EB',
    azureDim: '#4A6B75',
    azureDeep: '#152327',
  },
  editor: {
    background: '#050806',
    foreground: '#CDE5D1',
    lineHighlight: '#0A100C',
    lineNumber: '#314837',
    lineNumberActive: '#7A987F',
    selection: '#142B1D',
    inactiveSelection: '#0D1B12',
    widgetBackground: '#0B120E',
    widgetBorder: '#223729',
    cursor: '#5CCF8D',
    syntax: {
      comment: '#5A7360',
      keyword: '#7FD9A4',
      string: '#A6CC8E',
      number: '#D2BF83',
      type: '#8ED2B5',
      functionName: '#C7E8CE',
      variable: '#CDE5D1',
      operator: '#8BA191',
      tag: '#7FD9A4',
      attribute: '#D2BF83',
      invalid: '#DC8A8A',
    },
  },
  terminal: {
    background: '#020403',
    foreground: '#C9E3CD',
    cursor: '#5CCF8D',
    selection: '#142B1D',
  },
  atmosphere: { accent: 0.04, secondary: 0.016 },
  scrollbar: { thumb: '#102017', hover: '#1C3324' },
};

const sandstone: AppTheme = {
  id: 'sandstone',
  name: 'Sandstone',
  blurb: 'Warm dark taupe with a sand accent.',
  mode: 'dark',
  colors: {
    ink950: '#100D0A',
    ink900: '#15120E',
    ink850: '#1A1712',
    ink800: '#201C16',
    ink750: '#28231C',
    ink700: '#312A21',
    ink650: '#3B3328',
    line: '#312A21',
    lineStrong: '#40372B',
    lineFaint: '#1C1813',
    mistBright: '#EDE6D9',
    mist: '#BEB4A2',
    mistDim: '#948A79',
    mistFaint: '#70675A',
    mistGhost: '#4D463B',
    accent: '#C9B58A',
    accentSoft: '#E7D8B7',
    accentDim: '#6F6041',
    accentDeep: '#2B2417',
    mint: '#A9B98D',
    mintSoft: '#D3DFC1',
    mintDim: '#596444',
    mintDeep: '#202817',
    coral: '#D48F8F',
    coralSoft: '#EEC0C0',
    coralDim: '#6E4242',
    coralDeep: '#291515',
    sand: '#D3BE8C',
    sandSoft: '#E9DEBB',
    sandDim: '#695D35',
    sandDeep: '#262112',
    azure: '#A4B6C4',
    azureSoft: '#D3DFE8',
    azureDim: '#52616D',
    azureDeep: '#19222A',
  },
  editor: {
    background: '#15120E',
    foreground: '#E2DACC',
    lineHighlight: '#1B1712',
    lineNumber: '#4B4337',
    lineNumberActive: '#948A79',
    selection: '#2F2A21',
    inactiveSelection: '#221D16',
    widgetBackground: '#201C16',
    widgetBorder: '#3B3328',
    cursor: '#C9B58A',
    syntax: {
      comment: '#6C6356',
      keyword: '#D3BE8C',
      string: '#A9C0A0',
      number: '#DDC993',
      type: '#C9B58A',
      functionName: '#EDE6D9',
      variable: '#E2DACC',
      operator: '#9C9180',
      tag: '#D3BE8C',
      attribute: '#A9C0A0',
      invalid: '#D48F8F',
    },
  },
  terminal: {
    background: '#100D0A',
    foreground: '#DED5C6',
    cursor: '#C9B58A',
    selection: '#2F2A21',
  },
  atmosphere: { accent: 0.035, secondary: 0.012 },
  scrollbar: { thumb: '#332D25', hover: '#463E32' },
};

export const THEMES: AppTheme[] = [
  onyx,
  graphite,
  light,
  marimo,
  midnight,
  terminal,
  sandstone,
];

export const DEFAULT_THEME_ID: ThemeId = 'onyx';
const THEME_STORAGE_KEY = 'him.theme';

export function getTheme(id?: string | null): AppTheme {
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}

export function readStoredThemeId(): ThemeId {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && THEMES.some((theme) => theme.id === stored)) return stored as ThemeId;
  } catch {
    // localStorage can be unavailable in locked-down contexts
  }
  return DEFAULT_THEME_ID;
}

function hexToRgbTriplet(hex: string): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : value.slice(0, 6);
  const number = Number.parseInt(full, 16);
  return `${(number >> 16) & 255} ${(number >> 8) & 255} ${number & 255}`;
}

function cssVarName(key: string): string {
  return `--${key
    .replace(/([A-Z])/g, '-$1')
    .replace(/(\d+)$/, '-$1')
    .toLowerCase()}`;
}

export function applyThemeCss(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(cssVarName(key), hexToRgbTriplet(value));
  }
  root.style.setProperty('--scrollbar-thumb', hexToRgbTriplet(theme.scrollbar.thumb));
  root.style.setProperty('--scrollbar-thumb-hover', hexToRgbTriplet(theme.scrollbar.hover));
  root.style.setProperty('--terminal-bg', hexToRgbTriplet(theme.terminal.background));
  root.style.setProperty('--terminal-fg', hexToRgbTriplet(theme.terminal.foreground));
  root.style.setProperty('--terminal-cursor', hexToRgbTriplet(theme.terminal.cursor));
  root.style.setProperty('--atmo-a', String(theme.atmosphere.accent));
  root.style.setProperty('--atmo-b', String(theme.atmosphere.secondary));
  root.style.setProperty(
    '--panel-shadow',
    theme.mode === 'dark'
      ? '0 24px 64px -24px rgba(0, 0, 0, 0.72), 0 4px 16px -8px rgba(0, 0, 0, 0.5)'
      : '0 24px 64px -28px rgba(45, 40, 30, 0.28), 0 6px 18px -10px rgba(45, 40, 30, 0.16)',
  );
  root.style.setProperty(
    '--inset-shadow',
    theme.mode === 'dark'
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.035)'
      : 'inset 0 1px 0 rgba(255, 255, 255, 0.85)',
  );
  root.style.setProperty('--scrim', theme.mode === 'light' ? '24 21 16' : '0 0 0');
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // ignore
  }
}

export function monacoThemeName(theme: AppTheme): string {
  return `him-${theme.id}`;
}

export function xtermTheme(theme: AppTheme): Record<string, string> {
  const c = theme.colors;
  const light = theme.mode === 'light';
  return {
    background: theme.terminal.background,
    foreground: theme.terminal.foreground,
    cursor: theme.terminal.cursor,
    cursorAccent: theme.terminal.background,
    selectionBackground: theme.terminal.selection,
    selectionForeground: theme.terminal.foreground,
    black: light ? c.mistBright : c.ink900,
    red: c.coral,
    green: c.mint,
    yellow: c.sand,
    blue: c.azure,
    magenta: c.mintDim,
    cyan: c.accent,
    white: light ? c.mist : c.mistBright,
    brightBlack: c.mistFaint,
    brightRed: c.coralSoft,
    brightGreen: c.mintSoft,
    brightYellow: c.sandSoft,
    brightBlue: c.azureSoft,
    brightMagenta: c.accentDim,
    brightCyan: c.accentSoft,
    brightWhite: c.mistBright,
  };
}

export function themePreviewColors(theme: AppTheme): string[] {
  return [theme.colors.ink900, theme.colors.ink800, theme.colors.line, theme.colors.accent];
}
