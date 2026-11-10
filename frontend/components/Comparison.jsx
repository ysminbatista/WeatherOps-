'use client';
import { useEffect, useState } from 'react';
import { fetchHistory, fetchLocations } from '../lib/api.js';
import { useRefresh } from '../lib/useRefresh.js';
import {
  fmtDayLabel, fmtDiffKmh, fmtDiffMm, fmtDiffTemp, fmtKmh, fmtMm, fmtTemp, historyBadges,
} from '../lib/format.js';
import { S } from '../lib/strings.js';
import Header from './Header.jsx';
import Footer from './Footer.jsx';

const loadLocations = (_key, signal) => fetchLocations(signal);

// Grupos de colunas: campo no objeto forecast/observed/difference e formatadores.
const GROUPS = [
  { label: S.compare.tempMax, field: 'temperature_max', fmt: fmtTemp, fmtDiff: fmtDiffTemp },
  { label: S.compare.tempMin, field: 'temperature_min', fmt: fmtTemp, fmtDiff: fmtDiffTemp },
  { label: S.compare.rain, field: 'precipitation_sum', fmt: fmtMm, fmtDiff: fmtDiffMm },
  { label: S.compare.wind, field: 'wind_speed_max', fmt: fmtKmh, fmtDiff: fmtDiffKmh },
];

function Row({ day }) {
  const { weekday, day: dd } = fmtDayLabel(day.date);
  const badges = historyBadges(day);
  return (
    <tr>
      <th scope="row" className="cmp-date">{weekday} {dd}</th>
      {GROUPS.flatMap((g) => [
        <td key={`${g.field}-f`}>{g.fmt(day.forecast?.[g.field])}</td>,
        <td key={`${g.field}-o`}>{g.fmt(day.observed?.[g.field])}</td>,
        <td key={`${g.field}-d`} className="cmp-diff">{g.fmtDiff(day.difference?.[g.field])}</td>,
      ])}
      <td className="cmp-status">
        {badges.length === 0
          ? <span className="muted">{S.compare.full} {day.coverage_pct} {S.units.pct}</span>
          : badges.map((b) => <span key={b} className="badge">{b}</span>)}
      </td>
    </tr>
  );
}

function Table({ history }) {
  return (
    <div className="table-wrap">
      <table className="cmp">
        <thead>
          <tr>
            <th rowSpan={2} scope="col">{S.compare.date}</th>
            {GROUPS.map((g) => <th key={g.field} colSpan={3} scope="colgroup">{g.label}</th>)}
            <th rowSpan={2} scope="col">{S.compare.status}</th>
          </tr>
          <tr>
            {GROUPS.flatMap((g) => [
              <th key={`${g.field}-f`} scope="col">{S.compare.forecast}</th>,
              <th key={`${g.field}-o`} scope="col">{S.compare.observed}</th>,
              <th key={`${g.field}-d`} scope="col">{S.compare.diff}</th>,
            ])}
          </tr>
        </thead>
        <tbody>{history.map((d) => <Row key={d.date} day={d} />)}</tbody>
      </table>
    </div>
  );
}

export default function Comparison() {
  const locs = useRefresh('locations', loadLocations);
  const [selected, setSelected] = useState(null);
  const locations = locs.data ?? [];
  useEffect(() => {
    if (locations.length && !locations.some((l) => l.id === selected)) setSelected(locations[0].id);
  }, [locations, selected]);

  const hist = useRefresh(selected, fetchHistory);
  const data = hist.data;

  let body;
  if (locs.loading || (selected != null && hist.loading && !data)) {
    body = <p className="state" role="status">{S.loading}</p>;
  } else if (locs.error && !locs.data) {
    body = <p className="state state-error" role="alert">{S.error}</p>;
  } else if (!locations.length) {
    body = <p className="state">{S.noLocations}</p>;
  } else if (hist.error && !data) {
    body = <p className="state state-error" role="alert">{S.error}</p>;
  } else if (data) {
    body = (
      <section>
        {hist.error && <p className="banner banner-warn" role="alert">{S.errorStale}</p>}
        <h2>{S.compare.title} <span className="tag">{S.compare.reanalysis}</span></h2>
        <p className="muted">{S.compare.period}</p>
        <p className="note">{S.compare.note}</p>
        <Table history={data.history} />
      </section>
    );
  }

  return (
    <div className="page">
      <Header
        current="compare"
        locations={locations}
        selected={selected}
        onSelect={setSelected}
        lastUpdatedAt={data?.last_updated_at}
        stale={Boolean(data?.stale) && Boolean(data?.has_data)}
      />
      <main>{body}</main>
      <Footer />
    </div>
  );
}
