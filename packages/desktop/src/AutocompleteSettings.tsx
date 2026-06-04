import React, { useState, useEffect } from 'react'
import type { Theme } from './theme'
import type { AutocompleteConfig } from './lib/invoke'
import {
  getAutocompleteConfig,
  setAutocompleteEnabled,
  setAutocompleteSuggestionCount,
  setAutocompleteFallbackPhrases,
  getAccessibilityStatus,
} from './lib/invoke'

interface Props {
  theme: Theme
}

export function AutocompleteSettings({ theme }: Props) {
  const [config, setConfig] = useState<AutocompleteConfig | null>(null)
  const [accessOk, setAccessOk] = useState<boolean | null>(null)
  const [fallbackInput, setFallbackInput] = useState('')

  useEffect(() => {
    getAutocompleteConfig().then(setConfig)
    getAccessibilityStatus().then(setAccessOk)
  }, [])

  if (!config) return null

  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0', borderBottom: `0.5px solid ${theme.border}`,
  }
  const labelStyle: React.CSSProperties = { fontSize: 12, color: theme.text }
  const mutedStyle: React.CSSProperties = { fontSize: 11, color: theme.textMute }

  async function toggle() {
    const next = !config!.enabled
    await setAutocompleteEnabled(next)
    setConfig({ ...config!, enabled: next })
    if (next) setAccessOk(await getAccessibilityStatus())
  }

  async function setCount(count: number) {
    await setAutocompleteSuggestionCount(count)
    setConfig({ ...config!, suggestion_count: count })
  }

  async function addFallback() {
    if (!fallbackInput.trim()) return
    const phrases = [...config!.fallback_phrases, fallbackInput.trim()]
    await setAutocompleteFallbackPhrases(phrases)
    setConfig({ ...config!, fallback_phrases: phrases })
    setFallbackInput('')
  }

  async function removeFallback(i: number) {
    const phrases = config!.fallback_phrases.filter((_, idx) => idx !== i)
    await setAutocompleteFallbackPhrases(phrases)
    setConfig({ ...config!, fallback_phrases: phrases })
  }

  const toggleBg = config.enabled
    ? theme.accent
    : (theme.dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)')

  return (
    <div style={{ padding: '12px 0', flexShrink: 0 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: theme.textFaint, marginBottom: 8,
      }}>
        Autocomplete (Touch Bar)
      </div>

      {/* Enable toggle */}
      <div style={row}>
        <span style={labelStyle}>Enable word suggestions</span>
        <button
          style={{
            width: 36, height: 20, borderRadius: 10, border: 'none',
            cursor: 'pointer', background: toggleBg, position: 'relative',
            transition: 'background 0.2s',
          }}
          onClick={toggle}
          aria-label="toggle autocomplete"
        />
      </div>

      {/* Accessibility warning */}
      {config.enabled && accessOk === false && (
        <div style={{
          padding: '6px 8px', background: 'rgba(255,165,0,0.15)',
          borderRadius: 6, fontSize: 11, color: theme.textMute, marginTop: 4,
        }}>
          Needs Accessibility permission — System Settings &rarr; Privacy &amp; Security &rarr; Accessibility
        </div>
      )}

      {/* Suggestion count */}
      <div style={row}>
        <span style={labelStyle}>Suggestions shown</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {[3, 5].map(n => (
            <button
              key={n}
              onClick={() => setCount(n)}
              style={{
                padding: '3px 10px', borderRadius: 6, border: 'none',
                cursor: 'pointer', fontSize: 12,
                background: config.suggestion_count === n
                  ? theme.accent
                  : (theme.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'),
                color: config.suggestion_count === n ? '#fff' : theme.text,
              }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Fallback phrases */}
      <div style={{ marginTop: 8 }}>
        <span style={{ ...mutedStyle, display: 'block', marginBottom: 4 }}>
          Fallback phrases (shown when idle)
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {config.fallback_phrases.map((p, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 12,
                background: theme.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
                fontSize: 12, color: theme.text,
              }}
            >
              {p}
              <button
                onClick={() => removeFallback(i)}
                style={{ all: 'unset' as const, cursor: 'pointer', color: theme.textMute, fontSize: 10 }}
              >
                &#x2715;
              </button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            value={fallbackInput}
            onChange={e => setFallbackInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addFallback()}
            placeholder="Add phrase..."
            style={{
              flex: 1, padding: '4px 8px', fontSize: 12, borderRadius: 6,
              border: `0.5px solid ${theme.border}`,
              background: theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
              color: theme.text, outline: 'none',
            }}
          />
          <button
            onClick={addFallback}
            style={{
              padding: '4px 10px', borderRadius: 6, border: 'none',
              cursor: 'pointer', background: theme.accent, color: '#fff', fontSize: 12,
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
