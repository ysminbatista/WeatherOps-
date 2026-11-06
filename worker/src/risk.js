// Mapeia cada regra de risk_rules ao campo do dia. Os limites vêm do banco, nunca daqui.
const RULE_FIELDS = {
  rain_probability: 'precipitation_probability_max',
  precipitation_daily: 'precipitation_sum',
  wind_speed: 'wind_speed_max',
};

/** rules: linhas de risk_rules. Ignora regras inativas ou desconhecidas. */
export function evaluateRisk(day, rules) {
  const reasons = [];
  for (const rule of rules) {
    const field = RULE_FIELDS[rule.key];
    if (!rule.active || !field) continue;
    const value = day[field];
    if (value != null && Number(value) >= Number(rule.threshold)) reasons.push(rule.key);
  }
  return { is_risk: reasons.length > 0, risk_reasons: reasons };
}
