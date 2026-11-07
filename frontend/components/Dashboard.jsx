'use client';
import { useEffect, useState } from 'react';
import { fetchDashboard, fetchLocations } from '../lib/api.js';
import { useRefresh } from '../lib/useRefresh.js';
import { S } from '../lib/strings.js';
import Header from './Header.jsx';
import Cards from './Cards.jsx';
import Charts from './Charts.jsx';
import DailyForecast from './DailyForecast.jsx';
import Footer from './Footer.jsx';

const loadLocations = (_key, signal) => fetchLocations(signal);

export default function Dashboard() {
  const locs = useRefresh('locations', loadLocations);
  const [selected, setSelected] = useState(null);

  const locations = locs.data ?? [];
  useEffect(() => {
    if (locations.length && !locations.some((l) => l.id === selected)) setSelected(locations[0].id);
  }, [locations, selected]);

  const dash = useRefresh(selected, fetchDashboard);
  const summary = dash.data?.summary;

  let body;
  if (locs.loading || (selected != null && dash.loading && !dash.data)) {
    body = <p className="state" role="status">{S.loading}</p>;
  } else if (locs.error && !locs.data) {
    body = <p className="state state-error" role="alert">{S.error}</p>;
  } else if (!locations.length) {
    body = <p className="state">{S.noLocations}</p>;
  } else if (dash.error && !dash.data) {
    body = <p className="state state-error" role="alert">{S.error}</p>;
  } else if (summary && !summary.has_data) {
    body = (
      <div className="state" role="status">
        <strong>{S.empty}</strong>
        <p>{S.emptyDetail}</p>
      </div>
    );
  } else if (dash.data) {
    body = (
      <>
        {dash.error && <p className="banner banner-warn" role="alert">{S.errorStale}</p>}
        <Cards summary={summary} />
        <Charts hourly={dash.data.hourly} />
        <DailyForecast daily={dash.data.daily} />
      </>
    );
  }

  return (
    <div className="page">
      <Header
        locations={locations}
        selected={selected}
        onSelect={setSelected}
        lastUpdatedAt={summary?.last_updated_at}
        stale={Boolean(summary?.stale) && Boolean(summary?.has_data)}
      />
      <main>{body}</main>
      <Footer />
    </div>
  );
}
