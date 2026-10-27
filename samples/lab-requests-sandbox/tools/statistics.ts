/**
 * Count, mean, extremes and sample standard deviation of a result's readings. It sits beside the
 * analysis tool because the sandbox mounts only this directory of the sample.
 */
export function summarize(readings: readonly number[]) {
  const count = readings.length;
  const mean = readings.reduce((sum, value) => sum + value, 0) / count;
  const squares = readings.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    count,
    mean: round(mean),
    min: Math.min(...readings),
    max: Math.max(...readings),
    stdev: count > 1 ? round(Math.sqrt(squares / (count - 1))) : 0,
  };
}
