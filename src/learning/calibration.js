/**
 * Confidence Calibration — adjusts discovery confidence based on
 * historical accuracy patterns.
 *
 * If OWL's high-confidence discoveries consistently get negative feedback,
 * the calibration factor reduces future confidence. If low-confidence
 * discoveries are valued by the user, it boosts them.
 *
 * This creates a self-correcting feedback loop beyond just preference scoring.
 */

/**
 * Compute calibration factors based on historical discovery outcomes.
 *
 * Returns a calibration object with multipliers for different confidence bands.
 */
export function computeCalibration(worldModel) {
  const recent = worldModel.getRecentDiscoveries(
    new Date(Date.now() - 30 * 86_400_000).toISOString(),
    500
  );

  // Group discoveries into confidence bands
  const bands = {
    high: { total: 0, positive: 0, negative: 0, neutral: 0 },   // 0.8+
    medium: { total: 0, positive: 0, negative: 0, neutral: 0 },  // 0.6-0.8
    low: { total: 0, positive: 0, negative: 0, neutral: 0 }      // <0.6
  };

  for (const d of recent) {
    if (!d.user_reaction) continue;

    const band = d.confidence >= 0.8 ? 'high' : d.confidence >= 0.6 ? 'medium' : 'low';
    bands[band].total += 1;

    if (d.user_reaction === 'positive') bands[band].positive += 1;
    else if (d.user_reaction === 'negative') bands[band].negative += 1;
    else bands[band].neutral += 1;
  }

  // Compute calibration multipliers
  // Base idea: if a band has high positive rate, slightly boost confidence
  // If a band has high negative rate, reduce confidence
  const calibration = {};

  for (const [band, stats] of Object.entries(bands)) {
    if (stats.total < 3) {
      calibration[band] = 1.0; // Not enough data
      continue;
    }

    const positiveRate = stats.positive / stats.total;
    const negativeRate = stats.negative / stats.total;

    // Positive rate > 50% → slight boost; negative rate > 40% → reduce
    calibration[band] = Math.max(0.7, Math.min(1.3,
      1.0 + (positiveRate - 0.5) * 0.3 - negativeRate * 0.2
    ));
  }

  return calibration;
}

/**
 * Apply calibration to a discovery's confidence score.
 */
export function calibrateConfidence(confidence, calibration) {
  const band = confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low';
  const multiplier = calibration[band] || 1.0;
  return Math.max(0.1, Math.min(1.0, confidence * multiplier));
}

/**
 * Get a summary of calibration state for logging/debugging.
 */
export function getCalibrationSummary(calibration) {
  return Object.entries(calibration)
    .map(([band, multiplier]) => `${band}: ${multiplier.toFixed(2)}x`)
    .join(', ');
}
