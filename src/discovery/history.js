export function getLastRun(worldModel, scanType) {
  return worldModel.getUserPreference(`discovery:lastRun:${scanType}`) || null;
}

export function setLastRun(worldModel, scanType, timestamp) {
  worldModel.setUserPreference(`discovery:lastRun:${scanType}`, timestamp);
}
