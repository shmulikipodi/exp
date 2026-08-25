import type { Strings } from "./i18n";
import type { RailMode } from "./Rail";

/**
 * Everything that used to sit in a row across the top of the artwork. Five buttons
 * competing with the record for attention, on every screen, permanently — this is the
 * drawer they belong in.
 */
export function Settings({
  t,
  onClose,
  toggleLang,
  typeSet,
  setTypeSet,
  zoom,
  setZoom,
  rails,
  toggleRail,
  openKeys,
  openHistory,
  historyCount,
  keyCount,
}: {
  t: Strings;
  onClose: () => void;
  toggleLang: () => void;
  typeSet: string;
  setTypeSet: (v: string) => void;
  zoom: number;
  setZoom: (v: number) => void;
  rails: RailMode[];
  toggleRail: (m: RailMode) => void;
  openKeys: () => void;
  openHistory: () => void;
  historyCount: number;
  keyCount: number;
}) {
  const faces: [string, string][] = [
    ["a", "Bevan"],
    ["b", "Playfair"],
    ["c", "Archivo"],
    ["d", "Bricolage"],
  ];
  const panels: [RailMode, string][] = [
    ["lyrics", t.railLyrics],
    ["queue", t.railQueue],
    ["artist", t.railArtist],
    ["album", t.railAlbum],
  ];

  return (
    <div className="sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="panel settings" onClick={(e) => e.stopPropagation()}>
        <h2>{t.settings}</h2>

        <p className="rail-section">{t.settingsPanels}</p>
        <div className="chips">
          {panels.map(([id, name]) => (
            <button
              key={id}
              className={rails.includes(id) ? "on" : ""}
              onClick={() => toggleRail(id)}
            >
              {name}
            </button>
          ))}
        </div>
        <p className="help">{t.settingsPanelsHint}</p>

        <p className="rail-section">{t.settingsZoom}</p>
        <div className="chips">
          <button onClick={() => setZoom(Math.max(0.7, Math.round((zoom - 0.1) * 10) / 10))}>−</button>
          <span className="zoom-now">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(Math.min(1.6, Math.round((zoom + 0.1) * 10) / 10))}>+</button>
          {zoom !== 1 && <button onClick={() => setZoom(1)}>{t.settingsReset}</button>}
        </div>

        <p className="rail-section">{t.settingsType}</p>
        <div className="chips">
          {faces.map(([id, name]) => (
            <button key={id} className={typeSet === id ? "on" : ""} onClick={() => setTypeSet(id)}>
              {name}
            </button>
          ))}
        </div>

        <p className="rail-section">{t.settingsMore}</p>
        <div className="chips">
          <button onClick={toggleLang}>{t.other}</button>
          <button onClick={openHistory}>{t.historyButton(historyCount)}</button>
          <button onClick={openKeys}>{t.keysButton(keyCount)}</button>
        </div>

        <div className="row">
          <button className="primary" onClick={onClose}>
            {t.keysClose}
          </button>
        </div>
      </div>
    </div>
  );
}
