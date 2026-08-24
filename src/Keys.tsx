import { useState } from "react";
import type { Strings } from "./i18n";

const LS = "ln.keys";
const SLOTS = 3;

export function loadKeys(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS) ?? "[]");
    const keys = Array.isArray(raw) ? raw.map(String) : [];
    return [...keys, ...Array(SLOTS).fill("")].slice(0, SLOTS);
  } catch {
    return Array(SLOTS).fill("");
  }
}

export function liveKeys(): string[] {
  return loadKeys()
    .map((k) => k.trim())
    .filter(Boolean);
}

type Slot = { key: string; valid: boolean; cooling: boolean; readyInSeconds: number };

export function Keys({
  t,
  onClose,
}: {
  t: Strings;
  onClose: (changed: boolean) => void;
}) {
  const [draft, setDraft] = useState<string[]>(loadKeys());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [testing, setTesting] = useState(false);

  const filled = draft.map((k) => k.trim()).filter(Boolean);

  const persist = () => {
    localStorage.setItem(LS, JSON.stringify(draft.map((k) => k.trim())));
  };

  const test = async () => {
    persist();
    setTesting(true);
    setSlots(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ check: true, keys: filled }),
      });
      const data = await res.json();
      setSlots(data.slots ?? []);
    } catch {
      setSlots([]);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <div className="panel">
        <h2>{t.keysTitle}</h2>
        <p className="help">{t.keysHelp}</p>

        {draft.map((value, i) => (
          <input
            key={i}
            dir="ltr"
            value={value}
            spellCheck={false}
            placeholder={`${t.keysSlot} ${i + 1}`}
            onChange={(e) => {
              const next = [...draft];
              next[i] = e.target.value;
              setDraft(next);
              setSlots(null);
            }}
          />
        ))}

        {slots && (
          <ul className="slots">
            {slots.length === 0 && <li className="bad">{t.keysNone}</li>}
            {slots.map((s, i) => (
              <li key={i} className={s.valid ? (s.cooling ? "warned" : "good") : "bad"}>
                {s.key} —{" "}
                {!s.valid
                  ? t.keysInvalid
                  : s.cooling
                    ? t.keysCooling(s.readyInSeconds)
                    : t.keysGood}
              </li>
            ))}
          </ul>
        )}

        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="get">
          {t.keysGet}
        </a>

        <div className="row">
          <button onClick={test} disabled={testing || filled.length === 0}>
            {testing ? t.keysTesting : t.keysTest}
          </button>
          <button
            className="primary"
            onClick={() => {
              persist();
              onClose(true);
            }}
          >
            {t.save}
          </button>
          <button className="ghost" onClick={() => onClose(false)}>
            {t.keysClose}
          </button>
        </div>
      </div>
    </div>
  );
}
