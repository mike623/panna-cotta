export interface Tweaks {
  dark: boolean
  accent: string
  hue: number
  glassy: boolean
}

export interface Theme {
  dark: boolean
  accent: string
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
}

export const DEFAULT_TWEAKS: Tweaks = {
  dark: false,
  accent: 'oklch(0.72 0.18 230)',
  hue: 250,
  glassy: true,
}

export function makeTheme(t: Tweaks): Theme {
  const { dark, accent } = t
  return {
    dark, accent,
    bg: dark
      ? `radial-gradient(1200px 600px at 20% 0%, oklch(0.32 0.04 ${t.hue}) 0%, oklch(0.18 0.02 ${t.hue}) 60%, oklch(0.12 0.01 ${t.hue}) 100%)`
      : `radial-gradient(1200px 600px at 20% 0%, oklch(0.96 0.03 ${t.hue}) 0%, oklch(0.92 0.02 ${t.hue}) 55%, oklch(0.86 0.02 ${t.hue}) 100%)`,
    panel:        dark ? 'rgba(28,28,32,0.55)' : 'rgba(255,255,255,0.55)',
    panelStrong:  dark ? 'rgba(38,38,44,0.75)' : 'rgba(255,255,255,0.78)',
    border:       dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    borderStrong: dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
    inset:        dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)',
    text:         dark ? 'oklch(0.96 0.005 250)' : 'oklch(0.22 0.01 250)',
    textMute:     dark ? 'oklch(0.72 0.005 250)' : 'oklch(0.45 0.01 250)',
    textFaint:    dark ? 'oklch(0.55 0.005 250)' : 'oklch(0.6 0.01 250)',
    tile:         dark ? 'oklch(0.28 0.015 250)' : 'oklch(0.97 0.005 250)',
    tileEmpty:    dark ? 'oklch(0.22 0.01 250 / 0.5)' : 'oklch(0.92 0.005 250 / 0.5)',
    blur:         t.glassy ? 'blur(28px) saturate(180%)' : 'blur(8px) saturate(120%)',
    radius: 14,
    radiusLg: 22,
    font: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif',
  }
}
