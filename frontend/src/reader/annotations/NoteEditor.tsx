import { useEffect, useRef, useState } from 'react';

const AUTOSAVE_DEBOUNCE_MS = 600;

/** A note textarea that autosaves on pause rather than per keystroke (section 24). */
export default function NoteEditor({
  value,
  placeholder,
  onChange,
  className,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDraft(value), [value]);

  function handleInput(next: string) {
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(next), AUTOSAVE_DEBOUNCE_MS);
  }

  function handleBlur() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (draft !== value) onChange(draft);
  }

  return (
    <textarea
      className={className}
      value={draft}
      placeholder={placeholder ?? 'Add a note…'}
      onChange={(e) => handleInput(e.target.value)}
      onBlur={handleBlur}
      rows={3}
    />
  );
}
