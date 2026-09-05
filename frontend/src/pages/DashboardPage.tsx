import { useEffect, useState } from 'react';
import { useRouter } from '../router';
import { analytics } from '../services/api';
import type { OverviewStats } from '../types';
import { formatDuration } from '../utils/time';
import styles from './DashboardPage.module.css';

function Tile({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileValue}>{value}</div>
      <div className={styles.tileLabel}>{label}</div>
      {note && <div className={styles.tileNote}>{note}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const { navigate } = useRouter();
  const [stats, setStats] = useState<OverviewStats | null>(null);

  useEffect(() => {
    analytics.overview().then(setStats).catch(() => {});
  }, []);

  if (!stats) return null;

  const maxSeconds = Math.max(1, ...stats.last14Days.map((d) => d.seconds));
  const dayMap = new Map(stats.last14Days.map((d) => [d.day, d.seconds]));
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    const key = d.toISOString().slice(0, 10);
    return { key, seconds: dayMap.get(key) ?? 0, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }) };
  });

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <button type="button" className={styles.backButton} onClick={() => navigate('/')} aria-label="Back to library">
          ←
        </button>
        <span className={styles.title}>Reading Dashboard</span>
      </div>

      {stats.sessionCount === 0 ? (
        <p className={styles.empty}>Start reading a book and your stats will show up here.</p>
      ) : (
        <>
          <div className={styles.grid}>
            <Tile value={formatDuration(stats.totalSeconds)} label="Total time read" />
            <Tile value={String(stats.booksRead)} label="Books read" />
            <Tile value={`${stats.currentStreakDays}d`} label="Current streak" note={`Longest: ${stats.longestStreakDays}d`} />
            <Tile value={formatDuration(stats.avgSessionSeconds)} label="Avg. session" />
            <Tile value={stats.pagesRead.toLocaleString()} label="Pages read" note="Estimated" />
            <Tile value={stats.estimatedCharactersRead.toLocaleString()} label="Characters read" note="Estimated" />
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Last 14 days</h2>
            <div className={styles.chart}>
              {last14.map((d) => (
                <div key={d.key} className={styles.chartBarCol} title={formatDuration(d.seconds)}>
                  <div className={styles.chartBar} style={{ height: `${Math.max(2, (d.seconds / maxSeconds) * 100)}%` }} />
                  <span className={styles.chartDayLabel}>{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
