import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getActiveServer, getDefaultServers, getServerList, normalizeServerUrl, setServerList, testServer } from '../services/serverConfig';
import { IconArrowUp, IconClose } from '../reader/icons';
import styles from './ServerSettingsDialog.module.css';

type Status = { state: 'checking' } | { state: 'ok'; ms: number } | { state: 'down' };

/**
 * The list of server addresses this device tries (native app only — the web
 * app is served by the server itself). Every address is tried at once and
 * whichever answers first is used, so order only matters as a tiebreak.
 */
export default function ServerSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [servers, setServers] = useState<string[]>(getServerList);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const active = getActiveServer();

  // Check every address whenever the list changes, so the dots always
  // reflect what this device can reach right now.
  // A check already in flight keeps running when the list changes (adding a
  // server must not drop the others' results); only closing the dialog
  // discards them.
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);
  useEffect(() => {
    for (const url of servers) {
      if (status[url]) continue;
      setStatus((s) => ({ ...s, [url]: { state: 'checking' } }));
      testServer(url).then((ms) => {
        if (mounted.current) setStatus((s) => ({ ...s, [url]: ms === null ? { state: 'down' } : { state: 'ok', ms } }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers]);

  function add(e: FormEvent) {
    e.preventDefault();
    const url = normalizeServerUrl(draft);
    if (!url) {
      setDraftError('That doesn’t look like a server address.');
      return;
    }
    if (servers.includes(url)) {
      setDraftError('That address is already in the list.');
      return;
    }
    setServers([...servers, url]);
    setDraft('');
    setDraftError(null);
  }

  function remove(url: string) {
    setServers(servers.filter((u) => u !== url));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...servers];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setServers(next);
  }

  function retest() {
    setStatus({});
    setServers([...servers]);
  }

  function save() {
    setServerList(servers);
    onSaved?.();
    onClose();
  }

  const defaults = getDefaultServers();
  const isDefault = servers.length === defaults.length && servers.every((u, i) => u === defaults[i]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} role="dialog" aria-labelledby="servers-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 id="servers-title" className={styles.title}>
            Servers
          </h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <p className={styles.help}>
          This device tries every address at once and uses the first one that answers. Add your home address and any
          remote one, like Tailscale.
        </p>

        {servers.length === 0 ? (
          <p className={styles.empty}>No servers. Add one below.</p>
        ) : (
          <ul className={styles.list}>
            {servers.map((url, i) => {
              const st = status[url];
              return (
                <li key={url} className={styles.row}>
                  <span
                    className={`${styles.dot} ${st?.state === 'ok' ? styles.dotOk : st?.state === 'down' ? styles.dotDown : ''}`}
                    aria-hidden="true"
                  />
                  <div className={styles.rowText}>
                    <span className={styles.url}>{url}</span>
                    <span className={styles.meta}>
                      {st?.state === 'ok' ? `Reachable · ${st.ms} ms` : st?.state === 'down' ? 'Not reachable from here' : 'Checking…'}
                      {url === active ? ' · In use' : ''}
                    </span>
                  </div>
                  <button type="button" className={styles.iconButton} onClick={() => moveUp(i)} disabled={i === 0} aria-label="Move up">
                    <IconArrowUp />
                  </button>
                  <button type="button" className={styles.iconButton} onClick={() => remove(url)} aria-label={`Remove ${url}`}>
                    <IconClose />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form className={styles.addRow} onSubmit={add}>
          <input
            className={styles.input}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftError(null);
            }}
            placeholder="http://192.168.1.10:3001"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Server address"
          />
          <button type="submit" className={styles.addButton} disabled={!draft.trim()}>
            Add
          </button>
        </form>
        {draftError && (
          <p className={styles.error} role="alert">
            {draftError}
          </p>
        )}

        <div className={styles.footer}>
          <button type="button" className={styles.textButton} onClick={retest}>
            Check again
          </button>
          {!isDefault && defaults.length > 0 && (
            <button type="button" className={styles.textButton} onClick={() => { setStatus({}); setServers(defaults); }}>
              Reset
            </button>
          )}
          <span className={styles.spacer} />
          <button type="button" className={styles.primary} onClick={save} disabled={servers.length === 0}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
