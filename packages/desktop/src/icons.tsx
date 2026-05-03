import React from 'react'

const ICON_PATHS: Record<string, React.ReactNode> = {
  github:    <><circle cx="12" cy="12" r="9"/><path d="M9 19c-2 .5-3-1-4-2"/><path d="M15 21v-3a2 2 0 0 0-1-2c3 0 5-1 5-5 0-1-.4-2-1-3 .2-1 0-2-.5-3 0 0-1 0-3 1-2-.5-3-.5-5 0-2-1-3-1-3-1-.5 1-.7 2-.5 3-.6 1-1 2-1 3 0 4 2 5 5 5a2 2 0 0 0-1 2v3"/></>,
  google:    <><circle cx="12" cy="12" r="9"/><path d="M12 8v4h5"/><path d="M17 12a5 5 0 1 1-2-4"/></>,
  globe:     <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
  tab:       <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 6V4M11 6V4M15 6V4"/></>,
  bookmark:  <><path d="M7 3h10v18l-5-4-5 4z"/></>,
  app:       <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  volup:     <><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/></>,
  voldown:   <><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 10l4 4M20 10l-4 4"/></>,
  mute:      <><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6"/></>,
  sun:       <><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></>,
  moon:      <><path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10z"/></>,
  sleep:     <><path d="M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10z"/><path d="M14 4h4l-4 4h4"/></>,
  lock:      <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
  play:      <><path d="M7 5l12 7-12 7z"/></>,
  next:      <><path d="M5 5l10 7-10 7z"/><path d="M17 5v14"/></>,
  prev:      <><path d="M19 5l-10 7 10 7z"/><path d="M7 5v14"/></>,
  cmd:       <><path d="M8 8a2 2 0 1 1 2-2v12a2 2 0 1 1-2-2h8a2 2 0 1 1-2 2V6a2 2 0 1 1 2 2H8z"/></>,
  terminal:  <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></>,
  spark:     <><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></>,
  folder:    <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></>,
  home:      <><path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/></>,
  broadcast: <><circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/></>,
  calc:      <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M16 15h0M8 19h2M12 19h2M16 19h0"/></>,
  code:      <><path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/></>,
  chat:      <><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></>,
  shape:     <><circle cx="8" cy="8" r="4"/><rect x="13" y="13" width="7" height="7" rx="1"/><path d="M13 8h7M16 4v7"/></>,
  mail:      <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></>,
  calendar:  <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></>,
  video:     <><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></>,
  search:    <><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></>,
  plus:      <><path d="M12 5v14M5 12h14"/></>,
  minus:     <><path d="M5 12h14"/></>,
  x:         <><path d="M6 6l12 12M18 6l-6 6 0 0L6 18"/></>,
  check:     <><path d="M5 12l5 5 9-11"/></>,
  drag:      <><circle cx="9"  cy="6"  r="1"/><circle cx="9"  cy="12" r="1"/><circle cx="9"  cy="18" r="1"/><circle cx="15" cy="6"  r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></>,
  undo:      <><path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5h-3"/></>,
  redo:      <><path d="M15 14l4-4-4-4"/><path d="M19 10h-9a5 5 0 0 0-5 5v0a5 5 0 0 0 5 5h3"/></>,
  qr:        <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h2v2M18 14v3M14 18h2v3M18 21h3v-3"/></>,
  reset:     <><path d="M4 12a8 8 0 1 0 3-6"/><path d="M4 4v5h5"/></>,
  gear:      <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4.8a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2L5 5.9l-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-.8a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.8 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></>,
  layers:    <><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 18l9 5 9-5"/></>,
  device:    <><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/></>,
  zap:       <><path d="M13 3L4 14h7l-1 7 9-11h-7z"/></>,
  status:    <><circle cx="12" cy="12" r="4"/></>,
  pen:       <><path d="M14 4l6 6-12 12H2v-6z"/></>,
  trash:     <><path d="M5 7h14M9 7V4h6v3M7 7l1 13a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-13"/></>,
  copy:      <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
  arrowR:    <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  arrowL:    <><path d="M19 12H5M11 6l-6 6 6 6"/></>,
  arrowU:    <><path d="M12 19V5M6 11l6-6 6 6"/></>,
  arrowD:    <><path d="M12 5v14M6 13l6 6 6-6"/></>,
  more:      <><circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></>,
  keyboard:  <><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M6 14h0M10 14h0M14 14h0M18 14h0M7 17h10"/></>,
  swap:      <><path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"/></>,
  power:     <><path d="M12 3v9"/><path d="M6.5 5.5a8 8 0 1 0 11 0"/></>,
  settings:  <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4.8a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2L5 5.9l-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.4-.8a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.8 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/></>,
}

interface IconProps {
  name: string
  size?: number
  color?: string
  strokeWidth?: number
  style?: React.CSSProperties
}

export function Icon({ name, size = 20, color = 'currentColor', strokeWidth = 1.6, style = {} }: IconProps) {
  const path = ICON_PATHS[name] ?? ICON_PATHS.spark
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke={color} strokeWidth={strokeWidth}
         strokeLinecap="round" strokeLinejoin="round"
         style={{ flexShrink: 0, ...style }}>
      {path}
    </svg>
  )
}
