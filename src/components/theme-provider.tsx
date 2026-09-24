import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'

export type SetThemeOptions = {
  /** Wipe origin X (viewport coords). Defaults to last pointer position. */
  x?: number
  /** Wipe origin Y (viewport coords). Defaults to last pointer position. */
  y?: number
  /** Set false to switch instantly without animation. */
  animate?: boolean
}

type ThemeValue = {
  theme?: string
  setTheme: (
    theme: string | ((prev: string) => string),
    options?: SetThemeOptions,
  ) => void
  forcedTheme?: string
  resolvedTheme?: string
  themes: string[]
  systemTheme?: 'light' | 'dark'
}

type ThemeProviderProps = {
  children: ReactNode
  /** Storage key, must match the inline script in index.html. */
  storageKey?: string
  /** Theme used when nothing is stored. */
  defaultTheme?: string
  /** HTML attribute to set: "class" or "data-*" (string or list). */
  attribute?: string | string[]
  /** Map theme names to attribute values. */
  value?: Record<string, string>
  /** Expose "system" as a selectable theme. */
  enableSystem?: boolean
  /** Set `color-scheme` style alongside the attribute. */
  enableColorScheme?: boolean
  /** Override the stored theme. */
  forcedTheme?: string
  /** Available theme names (without "system"). */
  themes?: string[]
}

const MEDIA = '(prefers-color-scheme: dark)'
const DEFAULT_THEMES = ['light', 'dark']
const FALLBACK_ANIM_MS = 350

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia(MEDIA).matches ? 'dark' : 'light'
}

function readStored(storageKey: string, fallback: string): string {
  try {
    return localStorage.getItem(storageKey) ?? fallback
  } catch {
    return fallback
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

function canViewTransition(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function'
  )
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined)

const fallbackValue: ThemeValue = {
  setTheme: () => {},
  themes: [],
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext) ?? fallbackValue
}

export function ThemeProvider({
  children,
  storageKey = 'theme',
  defaultTheme = 'system',
  attribute = 'class',
  value,
  enableSystem = true,
  enableColorScheme = true,
  forcedTheme,
  themes = DEFAULT_THEMES,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState(() =>
    readStored(storageKey, defaultTheme),
  )
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() =>
    getSystemTheme(),
  )

  // Last pointer position → wipe origin, so toggle components don't need
  // to thread click coordinates through. Stale positions (>800ms, e.g.
  // keyboard toggles) fall back to viewport center.
  const pointerRef = useRef<{ x: number; y: number; at: number } | null>(null)
  const fallbackTimer = useRef<number | undefined>(undefined)
  const mountedRef = useRef(false)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY, at: Date.now() }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  useEffect(() => () => window.clearTimeout(fallbackTimer.current), [])

  const resolveName = useCallback(
    (name: string): string => {
      if (name === 'system' && enableSystem) return systemTheme
      return name
    },
    [enableSystem, systemTheme],
  )

  const applyDomTheme = useCallback(
    (name: string) => {
      const attrValue = value?.[name] ?? name
      const root = document.documentElement
      const apply = (attr: string) => {
        if (attr === 'class') {
          const all = themes.flatMap((t) => [value?.[t] ?? t, t])
          root.classList.remove(...new Set(all))
          if (attrValue) root.classList.add(attrValue)
        } else if (attr.startsWith('data-')) {
          if (attrValue) root.setAttribute(attr, attrValue)
          else root.removeAttribute(attr)
        }
      }
      if (Array.isArray(attribute)) attribute.forEach(apply)
      else apply(attribute)

      if (enableColorScheme) {
        root.style.colorScheme = name === 'light' || name === 'dark' ? name : ''
      }
    },
    [attribute, value, themes, enableColorScheme],
  )

  const resolvedTheme = forcedTheme ?? resolveName(theme)

  // Keep <html> in sync (system changes, cross-tab, forcedTheme). The
  // initial value is already set by the blocking inline script in
  // index.html (FOUC prevention); unlike `next-themes`, no `<script>` tag
  // is rendered — React 19 never executes component-rendered scripts.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      // Hand the background back to CSS now that styles are loaded
      // (otherwise <html>'s inline background blocks body from filling
      // the viewport).
      document.documentElement.style.removeProperty('background-color')
    }
    applyDomTheme(resolvedTheme)
  }, [resolvedTheme, applyDomTheme])

  // Track OS theme while "system" is in play (initial value comes from
  // the useState initializer above).
  useEffect(() => {
    const media = window.matchMedia(MEDIA)
    const onChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // Sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey) setThemeState(e.newValue ?? defaultTheme)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storageKey, defaultTheme])

  /** CSS-transition fallback for browsers without View Transitions. */
  const playCssFallback = useCallback(() => {
    const root = document.documentElement
    root.classList.add('theme-anim')
    window.clearTimeout(fallbackTimer.current)
    fallbackTimer.current = window.setTimeout(
      () => root.classList.remove('theme-anim'),
      FALLBACK_ANIM_MS,
    )
  }, [])

  const setTheme = useCallback(
    (
      next: string | ((prev: string) => string),
      options?: SetThemeOptions,
    ) => {
      const name = typeof next === 'function' ? next(theme) : next
      if (name === theme && !forcedTheme) return

      const commit = () => {
        try {
          localStorage.setItem(storageKey, name)
        } catch {
          // private mode etc. — theme still applies for this session
        }
        setThemeState(name)
      }

      const from = forcedTheme ?? resolveName(theme)
      const to = forcedTheme ?? resolveName(name)
      const animate = options?.animate !== false && !prefersReducedMotion()

      if (!animate || from === to || !canViewTransition()) {
        // Instant (or same resolved theme), or CSS fallback where the
        // .theme-anim class enables property transitions.
        if (animate && from !== to) playCssFallback()
        commit()
        return
      }

      // View Transition wipe: full-pixel snapshot crossfade, so shadows,
      // toasts and charts animate together instead of snapping.
      const last = pointerRef.current
      const fresh = last && Date.now() - last.at < 800 ? last : null
      const x = options?.x ?? fresh?.x ?? window.innerWidth / 2
      const y = options?.y ?? fresh?.y ?? window.innerHeight / 2
      const root = document.documentElement
      root.style.setProperty('--theme-x', `${x}px`)
      root.style.setProperty('--theme-y', `${y}px`)

      document.startViewTransition(() => {
        flushSync(commit)
        // Passive effects haven't run when the "new" snapshot is taken,
        // so apply synchronously; the effect re-applies the same values.
        applyDomTheme(to)
      })
    },
    [storageKey, theme, forcedTheme, resolveName, applyDomTheme, playCssFallback],
  )

  const contextValue = useMemo<ThemeValue>(
    () => ({
      theme: forcedTheme ?? theme,
      setTheme,
      forcedTheme,
      resolvedTheme,
      themes: enableSystem ? [...themes, 'system'] : [...themes],
      systemTheme: enableSystem ? systemTheme : undefined,
    }),
    [
      theme,
      setTheme,
      forcedTheme,
      resolvedTheme,
      themes,
      enableSystem,
      systemTheme,
    ],
  )

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  )
}
