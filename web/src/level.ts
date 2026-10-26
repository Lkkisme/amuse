/**
 * The maths behind the recording meter (components/VoiceMeter.tsx): the level
 * of a slice of sound, its smoothing, the bars kept for drawing, the timer and
 * the "can't hear you" check. Pure, so the browser's audio stays in the component.
 */

/** How often a level is taken, and how many bars the meter keeps (a few seconds at the pace of the bars). */
export const SAMPLE_MS = 50;
export const BARS = 64;

/** Below this level (0 to 1) nothing is being said; if it stays so this long from the start, the mic is probably wrong. */
export const QUIET = 0.08;
export const QUIET_AFTER_MS = 4000;

/** The loudness range shown, in decibels below full scale: quieter than FLOOR is an empty bar, CEILING a full one. */
const FLOOR = -60;
const CEILING = -12;

/** The root mean square of a slice of samples (each -1 to 1): 0 for silence, about 0.7 for a full-scale sine. */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** An RMS as the 0 to 1 height of a bar: on a decibel scale, since that is how loudness is heard, and clamped. */
export function level(amplitude: number): number {
  if (!(amplitude > 0)) return 0;
  const db = 20 * Math.log10(amplitude);
  return Math.min(1, Math.max(0, (db - FLOOR) / (CEILING - FLOOR)));
}

/** The next displayed level: it rises quickly to a louder sound and falls slowly, so the bars do not flicker. */
export function smooth(shown: number, next: number): number {
  const weight = next > shown ? 0.6 : 0.2;
  return shown + (next - shown) * weight;
}

/** The bars with one more at the end, the oldest dropped once there are `capacity`. */
export function push(bars: readonly number[], value: number, capacity: number = BARS): number[] {
  const kept = bars.length >= capacity ? bars.slice(bars.length - capacity + 1) : bars.slice();
  kept.push(value);
  return kept;
}

/** Whether the start of a recording has been silent so long that the hint shows: `peak` is the loudest level since it began. Once anything is heard it is over for good. */
export function silentAtStart(peak: number, elapsedMs: number): boolean {
  return elapsedMs >= QUIET_AFTER_MS && peak < QUIET;
}

/** Elapsed time as `0:07`, or `12:03`, or `1:02:03` past the hour. */
export function clock(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}:${seconds}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
}
