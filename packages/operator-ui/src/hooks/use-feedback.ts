import * as React from 'react';

export type FeedbackCue = 'scan' | 'accepted' | 'rejected' | 'attention';

/** Tone sequences: [frequency Hz, duration ms] pairs, distinct by pitch and rhythm. */
export const feedbackTones: Readonly<Record<FeedbackCue, readonly (readonly [number, number])[]>> =
  {
    scan: [[1800, 40]],
    accepted: [
      [880, 70],
      [1320, 110],
    ],
    rejected: [[220, 450]],
    attention: [
      [990, 90],
      [0, 60],
      [990, 90],
      [0, 60],
      [990, 90],
    ],
  };
const vibration: Readonly<Record<FeedbackCue, number | number[]>> = {
  scan: 20,
  accepted: [40, 40, 60],
  rejected: [300],
  attention: [80, 60, 80, 60, 80],
};

const storageKey = 'operator-feedback-muted';
function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

/**
 * Audible and haptic confirmation. Operators watch the machine, not the screen, so every commit,
 * rejection and request for attention has a sound that can be told apart without looking. The
 * audio context starts on the first user gesture, as browsers require. Muting is per device.
 */
export function useFeedback() {
  const [muted, setMutedState] = React.useState(readMuted);
  const context = React.useRef<AudioContext | undefined>(undefined);

  const play = React.useCallback(
    (cue: FeedbackCue) => {
      if (muted) return;
      try {
        globalThis.navigator?.vibrate?.(vibration[cue]);
      } catch {
        // Vibration is optional.
      }
      const Audio =
        globalThis.AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      context.current ??= new Audio();
      const audio = context.current;
      if (audio.state === 'suspended') void audio.resume();
      let at = audio.currentTime;
      for (const [frequency, duration] of feedbackTones[cue]) {
        const seconds = duration / 1000;
        if (frequency > 0) {
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.type = cue === 'rejected' ? 'square' : 'sine';
          oscillator.frequency.value = frequency;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.25, at + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
          oscillator.connect(gain).connect(audio.destination);
          oscillator.start(at);
          oscillator.stop(at + seconds + 0.02);
        }
        at += seconds;
      }
    },
    [muted],
  );
  const setMuted = React.useCallback((value: boolean) => {
    setMutedState(value);
    try {
      globalThis.localStorage?.setItem(storageKey, value ? '1' : '0');
    } catch {
      // Storage may be unavailable; the setting then lasts for this session.
    }
  }, []);
  React.useEffect(() => () => void context.current?.close().catch(() => undefined), []);
  return { play, muted, setMuted };
}
