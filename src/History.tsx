import { useEffect, useState } from "react";
import type { Strings } from "./i18n";
import { clearHistory, type Entry, forget, history, loadNotes, ready, usage } from "./store";

export function History({
  t,
  onOpen,
  onClose,
}: {
  t: Strings;
  onOpen: (entry: Entry, notes: unknown) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [size, setSize] = useState<{ count: number; mb: number } | null>(null);

  useEffect(() => {
    ready().then(() => {
      setEntries([...history()]);
      usage().then(setSize);
    });
  }, []);

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="panel history">
        <h2>{t.historyTitle}</h2>

        {entries.length === 0 ? (
          <p className="help">{t.historyEmpty}</p>
        ) : (
          <ul className="past">
            {entries.map((e) => (
              <li key={`${e.id}:${e.lang}`}>
                <button
                  className="open"
                  onClick={async () => {
                    const notes = await loadNotes(e.id, e.lang);
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
                  onClick={async () => {
                    await forget(e.id, e.lang);
                    setEntries([...history()]);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {size && size.count > 0 && (
          <p className="usage">{t.historyUsage(size.count, size.mb)}</p>
        )}

        <div className="row">
          {entries.length > 0 && (
            <button
              onClick={async () => {
                if (!confirm(t.historyClearConfirm)) return;
                await clearHistory();
                setEntries([]);
                onClose();
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
