import { useEffect, useRef, useState } from 'react';

const prefix = 'marginalia-draft:';
const pending = new Set();
export function hasUnsavedDrafts() {
  if (pending.size) return true;
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith(prefix)) return true;
  } catch { /* the in-memory set still protects this session */ }
  return false;
}

export function useDraft(key, value, onCommit) {
  const storageKey = prefix + key;
  const initial = () => {
    try { return localStorage.getItem(storageKey) ?? value ?? ''; } catch { return value || ''; }
  };
  const [draft, setState] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const latest = useRef(draft);
  const saved = useRef(value || '');
  const callback = useRef(onCommit);
  callback.current = onCommit;
  const busy = useRef(false);

  const remember = (text) => {
    latest.current = text;
    setState(text);
    if (text === saved.current) {
      pending.delete(storageKey);
      try { localStorage.removeItem(storageKey); } catch { /* best effort */ }
    } else {
      pending.add(storageKey);
      try { localStorage.setItem(storageKey, text); }
      catch { setError('Draft could not be stored. Keep this page open and retry saving.'); }
    }
  };
  useEffect(() => {
    const dirty = latest.current !== saved.current;
    saved.current = value || '';
    if (!dirty || latest.current === saved.current) remember(saved.current);
  }, [value, storageKey]);

  const commit = async () => {
    if (busy.current || latest.current === saved.current) return latest.current === saved.current;
    busy.current = true; setSaving(true); setError('');
    const text = latest.current;
    try {
      await callback.current(text.trim());
      saved.current = text.trim();
      if (latest.current === text) remember(text.trim());
      return true;
    } catch (err) {
      setError(err?.message || 'Could not save. Your draft is retained; try again.');
      return false;
    } finally { busy.current = false; setSaving(false); }
  };
  const discard = () => { setError(''); remember(value || ''); };
  return { draft, setDraft: remember, commit, discard, error, saving };
}
