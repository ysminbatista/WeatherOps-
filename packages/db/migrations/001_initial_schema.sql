CREATE TABLE locations (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  latitude   numeric(8,5) NOT NULL,
  longitude  numeric(8,5) NOT NULL,
  timezone   text NOT NULL DEFAULT 'America/Sao_Paulo',
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fetch_runs (
  id            bigserial PRIMARY KEY,
  location_id   integer NOT NULL REFERENCES locations(id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL CHECK (status IN ('running', 'success', 'error')),
  http_status   integer,
  error_message text,
  raw_payload   jsonb
);
CREATE INDEX fetch_runs_location_started_idx ON fetch_runs (location_id, started_at);

CREATE TABLE current_conditions (
  fetch_run_id         bigint NOT NULL REFERENCES fetch_runs(id) ON DELETE CASCADE,
  location_id          integer NOT NULL REFERENCES locations(id),
  observed_at          timestamptz NOT NULL,
  temperature_2m       numeric,
  apparent_temperature numeric,
  precipitation        numeric,
  wind_speed_10m       numeric,
  weather_code         integer
);
CREATE INDEX current_conditions_run_idx ON current_conditions (fetch_run_id);

CREATE TABLE hourly_forecast (
  fetch_run_id              bigint NOT NULL REFERENCES fetch_runs(id) ON DELETE CASCADE,
  location_id               integer NOT NULL REFERENCES locations(id),
  forecast_time             timestamptz NOT NULL,
  temperature_2m            numeric,
  apparent_temperature      numeric,
  precipitation_probability integer,
  precipitation             numeric,
  wind_speed_10m            numeric,
  weather_code              integer
);
CREATE INDEX hourly_forecast_loc_run_time_idx
  ON hourly_forecast (location_id, fetch_run_id, forecast_time);

CREATE TABLE daily_forecast (
  fetch_run_id                  bigint NOT NULL REFERENCES fetch_runs(id) ON DELETE CASCADE,
  location_id                   integer NOT NULL REFERENCES locations(id),
  forecast_date                 date NOT NULL,
  temperature_max               numeric,
  temperature_min               numeric,
  precipitation_sum             numeric,
  precipitation_probability_max integer,
  wind_speed_max                numeric,
  weather_code                  integer,
  is_risk                       boolean NOT NULL DEFAULT false,
  risk_reasons                  text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX daily_forecast_loc_run_date_idx
  ON daily_forecast (location_id, fetch_run_id, forecast_date);

CREATE TABLE risk_rules (
  key       text PRIMARY KEY,
  threshold numeric NOT NULL,
  unit      text NOT NULL,
  active    boolean NOT NULL DEFAULT true
);

CREATE TABLE observed_daily (
  location_id       integer NOT NULL REFERENCES locations(id),
  date              date NOT NULL,
  temperature_max   numeric,
  temperature_min   numeric,
  precipitation_sum numeric,
  wind_speed_max    numeric,
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, date)
);
