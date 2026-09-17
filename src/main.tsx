import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted so there's no CDN request, no flash of unstyled text, and no dependency
// on a third party staying up. Bevan announces, Roboto Slab reads, Plex Mono labels,
// Archivo names things; Suez One, Frank Ruhl Libre and Heebo do all of it in Hebrew,
// because none of the Latin faces carry a single Hebrew glyph.
import "@fontsource-variable/frank-ruhl-libre"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "@fontsource/ibm-plex-mono/600.css"
import "@fontsource-variable/heebo"
import "@fontsource-variable/archivo"
import "@fontsource/bevan"
import "@fontsource-variable/roboto-slab"
import "@fontsource/suez-one"
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
