'use client';
import {
  Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtHour, fmtUpdatedAt } from '../lib/format.js';
import { S } from '../lib/strings.js';

const C = { temp: '#d9480f', rain: '#1c7ed6', prob: '#5f3dc4', grid: '#e3e6ea', text: '#5b6470' };

const tick = { fontSize: 12, fill: C.text };
const tipLabel = (iso) => fmtUpdatedAt(iso);

export default function Charts({ hourly }) {
  const data = hourly.map((h) => ({
    ...h,
    precipitation: h.precipitation ?? 0,
  }));
  if (!data.length) return null;

  return (
    <section className="charts">
      <figure className="panel">
        <figcaption>{S.charts.temperature} ({S.units.temp})</figcaption>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="time" tickFormatter={fmtHour} tick={tick} minTickGap={32} />
              <YAxis tick={tick} unit={` ${S.units.temp}`} width={56} domain={['auto', 'auto']} />
              <Tooltip labelFormatter={tipLabel} formatter={(v) => [`${v} ${S.units.temp}`, S.charts.temperatureSeries]} />
              <Line isAnimationActive={false} type="monotone" dataKey="temperature" stroke={C.temp} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <figure className="panel">
        <figcaption>{S.charts.rain} ({S.units.mm} e {S.units.pct})</figcaption>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="time" tickFormatter={fmtHour} tick={tick} minTickGap={32} />
              <YAxis yAxisId="mm" tick={tick} unit={` ${S.units.mm}`} width={56} allowDecimals />
              <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={tick} unit={S.units.pct} width={48} />
              <Tooltip
                labelFormatter={tipLabel}
                formatter={(v, name) => (name === 'precipitation'
                  ? [`${v} ${S.units.mm}`, S.charts.precipSeries]
                  : [`${v} ${S.units.pct}`, S.charts.probSeries])}
              />
              <Bar isAnimationActive={false} yAxisId="mm" dataKey="precipitation" fill={C.rain} />
              <Line isAnimationActive={false} yAxisId="pct" type="monotone" dataKey="precipitation_probability" stroke={C.prob} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </section>
  );
}
