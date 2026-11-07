import { fmtUpdatedAt } from '../lib/format.js';
import { S } from '../lib/strings.js';

export default function Header({ locations, selected, onSelect, lastUpdatedAt, stale }) {
  return (
    <header className="header">
      <div className="header-row">
        <h1>{S.appName}</h1>
        <label className="select-wrap">
          <span>{S.locationLabel}</span>
          <select value={selected ?? ''} onChange={(e) => onSelect(Number(e.target.value))} disabled={!locations.length}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <p className="updated">
          {S.lastUpdate}: <strong>{lastUpdatedAt ? fmtUpdatedAt(lastUpdatedAt) : '—'}</strong>
        </p>
      </div>
      {stale && (
        <p className="banner banner-warn" role="alert">
          {S.staleWarning} {fmtUpdatedAt(lastUpdatedAt)}
        </p>
      )}
    </header>
  );
}
