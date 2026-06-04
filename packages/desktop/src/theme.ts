export interface Tweaks {
  dark: boolean
  accent: string
  hue: number       // used only for decorative blob in PannaApp
  glassy: boolean
}

export interface Theme {
  dark: boolean
  accent: string
  matcha: string
  bg: string
  panel: string
  panelStrong: string
  border: string
  borderStrong: string
  inset: string
  text: string
  textMute: string
  textFaint: string
  tile: string
  tileEmpty: string
  blur: string
  radius: number
  radiusLg: number
  font: string
  fontSerif: string
}

export const DEFAULT_TWEAKS: Tweaks = {
  dark: false,
  accent: '#C8472E',
  hue: 220,
  glassy: true,
}

export function makeTheme(t: Tweaks): Theme {
  const { dark, accent } = t
  const matcha = dark ? 'oklch(0.66 0.07 130)' : 'oklch(0.52 0.07 130)'
  return {
    dark, accent, matcha,
    bg: dark
      ? `radial-gradient(1100px 620px at 12% -8%, rgba(255,255,255,.045), transparent 60%),
         radial-gradient(820px 700px at 104% 112%, rgba(0,0,0,.45), transparent 60%),
         #15161a`
      : `radial-gradient(1100px 620px at 12% -8%, rgba(255,255,255,.55), transparent 60%),
         radial-gradient(820px 700px at 104% 112%, rgba(33,31,27,.045), transparent 60%),
         #EFE7D6`,
    panel:        dark ? 'rgba(26,28,32,0.72)'   : 'rgba(244,236,220,0.72)',
    panelStrong:  dark ? 'rgba(29,31,36,0.92)'   : 'rgba(246,241,232,0.92)',
    border:       dark ? 'rgba(255,255,255,0.09)' : 'rgba(33,31,27,0.10)',
    borderStrong: dark ? 'rgba(255,255,255,0.15)' : 'rgba(33,31,27,0.17)',
    inset:        dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)',
    text:         dark ? '#ece7dc' : '#211F1B',
    textMute:     dark ? '#9b9484' : '#6f675a',
    textFaint:    dark ? '#6c665a' : '#a99f8c',
    tile:         dark ? '#1d1f24' : '#E7DDC9',
    tileEmpty:    dark ? 'rgba(29,31,36,0.5)' : 'rgba(231,221,201,0.5)',
    blur:         t.glassy ? 'blur(20px) saturate(140%)' : 'blur(7px) saturate(115%)',
    radius: 12,
    radiusLg: 18,
    font: '"Zen Kaku Gothic New", system-ui, sans-serif',
    fontSerif: '"Shippori Mincho", "Hiragino Mincho ProN", serif',
  }
}
