'use client';

// "Which model for what": the research scores as an easy-to-read table. A job filter (segmented control)
// highlights that column and sorts the rows by it; the top score in each column gets a "Best" mark.

import { useMemo, useState } from 'react';
import { Score } from '@/components/ModelsPanel';

export default function ModelGuide({ models, kinds }) {
  const [job, setJob] = useState('');
  const best = useMemo(() => Object.fromEntries(kinds.map(([k]) => [k, Math.max(0, ...models.map((m) => m.scores?.[k] || 0))])), [models, kinds]);
  const rows = useMemo(() => (job ? [...models].sort((a, b) => (b.scores?.[job] || 0) - (a.scores?.[job] || 0) || (a.weight || 0) - (b.weight || 0)) : models), [models, job]);
  return (
    <>
      <div className="segmented" role="group" aria-label="Sort by job">
        <button type="button" aria-pressed={!job} onClick={() => setJob('')}>All</button>
        {kinds.map(([k, label]) => <button type="button" key={k} aria-pressed={job === k} onClick={() => setJob(k)}>{label}</button>)}
      </div>
      <div className="table-wrap">
        <table className="table guide">
          <thead>
            <tr><th>Model</th>{kinds.map(([k, label]) => <th key={k} className={job === k ? 'sel' : ''}>{label}</th>)}<th>Uses limits</th></tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td><b>{m.label}</b><div className="faint small-text">{m.providerLabel}{m.note ? ` · ${m.note}` : ''}</div></td>
                {kinds.map(([k]) => {
                  const v = m.scores?.[k] || 0;
                  const top = job === k && v && v === best[k]; // "Best" only in the chosen job's column, to keep the table calm
                  return <td key={k} className={`${job === k ? 'sel' : ''}${top ? ' best' : ''}`}><Score value={v} />{top ? <span className="best-tag">Best</span> : null}</td>;
                })}
                <td className="faint num">{m.weight ? `×${m.weight}` : 'free'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
