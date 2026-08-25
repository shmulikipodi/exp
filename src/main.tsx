import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted so there's no CDN request, no flash of unstyled text, and no dependency
// on a third party staying up. Fraunces displays, Newsreader reads, Plex Mono labels,
// Frank Ruhl Libre carries Hebrew — the Latin serifs have no Hebrew glyphs at all.
import "@fontsource-variable/fraunces"
import "@fontsource-variable/newsreader"
import "@fontsource-variable/newsreader/wght-italic.css"
import "@fontsource-variable/frank-ruhl-libre"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "@fontsource/ibm-plex-mono/600.css"
// Candidates for the type picker. Only the chosen set is ever rendered; the browser
// fetches a face when a rule actually asks for it, so the others cost nothing to keep.
import "@fontsource/instrument-serif"
import "@fontsource-variable/literata"
import "@fontsource-variable/source-serif-4"
import "@fontsource-variable/playfair-display"
import "@fontsource-variable/jetbrains-mono"
import "@fontsource-variable/lora"
import "@fontsource-variable/bricolage-grotesque"
import "@fontsource-variable/heebo"
import "@fontsource-variable/assistant"
import "@fontsource-variable/rubik"
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
