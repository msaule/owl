export function nowIso() {
  return new Date().toISOString();
}

export function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export function hoursAgo(hours) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60_000).toISOString();
}

export function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 86_400_000).toISOString();
}

export function startOfTodayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function msUntil(date) {
  return Math.max(0, new Date(date).getTime() - Date.now());
}

function fieldMatches(value, expression) {
  if (expression === '*') {
    return true;
  }

  if (/^\d+$/.test(expression)) {
    return value === Number.parseInt(expression, 10);
  }

  const stepMatch = expression.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = Number.parseInt(stepMatch[1], 10);
    return value % step === 0;
  }

  return false;
}

export function nextCronOccurrence(expression, from = new Date()) {
  const parts = String(expression || '').trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minuteExpr, hourExpr, dayExpr, monthExpr, weekdayExpr] = parts;
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let index = 0; index < 525_600; index += 1) {
    if (
      fieldMatches(cursor.getMinutes(), minuteExpr) &&
      fieldMatches(cursor.getHours(), hourExpr) &&
      fieldMatches(cursor.getDate(), dayExpr) &&
      fieldMatches(cursor.getMonth() + 1, monthExpr) &&
      fieldMatches(cursor.getDay(), weekdayExpr)
    ) {
      return cursor.toISOString();
    }

    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}
