function incrementPreference(worldModel, key, delta) {
  const current = worldModel.getUserPreference(key) || 0;
  worldModel.setUserPreference(key, current + delta);
}

export function recordDiscoveryPreference(worldModel, discovery, delta = 1) {
  incrementPreference(worldModel, `preference:type:${discovery.type}`, delta);
  incrementPreference(worldModel, `preference:urgency:${discovery.urgency}`, delta);

  for (const source of discovery.sources || []) {
    incrementPreference(worldModel, `preference:source:${source}`, delta);
  }
}

export function getPreferenceSummary(worldModel) {
  const keys = ['connection', 'anomaly', 'risk', 'opportunity', 'anticipation', 'time_sensitive']
    .map((type) => ({
      key: type,
      score: worldModel.getUserPreference(`preference:type:${type}`) || 0
    }))
    .sort((left, right) => right.score - left.score)
    .filter((item) => item.score !== 0)
    .slice(0, 3);

  if (!keys.length) {
    return 'No strong learned preferences yet.';
  }

  return `Most valued discovery types so far: ${keys.map((item) => `${item.key} (${item.score})`).join(', ')}`;
}
