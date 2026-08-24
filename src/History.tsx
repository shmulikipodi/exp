import type { Strings } from "./i18n";
import { clearHistory, forget, history, loadNotes, type Stored } from "./store";

export function History({
  t,
  onOpen,
  onClose,
}: {
  t: Strings;
  onOpen: (entry: Omit<Stored, "notes">, notes: unknown) => void;
  onClose: () => void;
}) {
  const entries = history();

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="panel">
        <h2>{t.historyTitle}</h2>

        {entries.length === 0 ? (
          <p className="help">{t.historyEmpty}</p>
        ) : (
          <ul className="past">
            {entries.map((e) => (
              <li key={`${e.id}:${e.lang}`}>
                <button
                  className="open"
                  onClick={() => {
                    const notes = loadNotes(e.id, e.lang);
                    if (notes) onOpen(e, notes);
                  }}
                >
                  {e.art && <img src={e.art} alt="" loading="lazy" />}
                  <span className="what">
                    <b>{e.title}</b>
                    <span>{e.artists.join(", ")}</span>
                  </span>
                  <span className="when">{new Date(e.at).toLocaleDateString()}</span>
                </button>
                <button
                  className="drop"
                  title={t.historyForget}
                  aria-label={t.historyForget}
                  onClick={(ev) => {
                    forget(e.id, e.lang);
                    // The list is read straight from storage, so nudge a re-render.
                    ev.currentTarget.closest("li")?.remove();
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="row">
          {entries.length > 0 && (
            <button
              onClick={() => {
                if (confirm(t.historyClearConfirm)) {
                  clearHistory();
                  onClose();
                }
              }}
            >
              {t.historyClear}
            </button>
          )}
          <button className="primary" onClick={onClose}>
            {t.keysClose}
          </button>
        </div>
      </div>
    </div>
  );
}
