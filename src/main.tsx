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
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
