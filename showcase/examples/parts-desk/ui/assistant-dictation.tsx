import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Dictation into the composer through the browser's speech recognition, on this device only.
 * Every recognizer is created with `processLocally`, which the Web Speech API defines as "must
 * run on-device": a browser without a local model for the language fails the start with
 * `service-not-allowed` instead of sending the audio to a speech service. A browser that cannot
 * check or require on-device recognition gets no button at all.
 */

const LANGUAGE = 'en-US';
const ON_DEVICE = { langs: [LANGUAGE], processLocally: true };

type Availability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

/** The part of `SpeechRecognition` dictation uses; the DOM library does not declare all of it. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionClass {
  new (): Recognition;
  prototype: object;
  available?(options: typeof ON_DEVICE): Promise<Availability>;
  install?(options: typeof ON_DEVICE): Promise<boolean>;
}

/** The browser's recognizer, if it can check for and require on-device recognition. */
// #region recognizer
function onDeviceRecognizer(): RecognitionClass | undefined {
  const scope = globalThis as {
    SpeechRecognition?: RecognitionClass;
    webkitSpeechRecognition?: RecognitionClass;
  };
  const recognizer = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!recognizer || typeof recognizer.available !== 'function') return undefined;
  if (!('processLocally' in recognizer.prototype)) return undefined;
  return recognizer;
}
// #endregion recognizer

const refusals: Record<string, string> = {
  'not-allowed': 'The browser did not allow the microphone.',
  'audio-capture': 'No microphone was found.',
  'service-not-allowed': 'This browser cannot recognize English speech on this device.',
  'language-not-supported': 'This browser cannot recognize English speech on this device.',
};

/**
 * Dictate into the composer's text. The words go after what the text already holds, interim words
 * included, and the person edits and sends them; dictation never sends. Any change to the text
 * that dictation did not write, such as typing, a send or New conversation, ends it.
 */
export function useDictation(text: string, setText: (text: string) => void) {
  const [availability, setAvailability] = useState<Availability>();
  const [listening, setListening] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();
  const recognition = useRef<Recognition>(undefined);
  /** The text dictation last wrote, to tell its own changes from the person's. */
  const written = useRef<string>(undefined);

  useEffect(() => {
    const recognizer = onDeviceRecognizer();
    if (!recognizer) {
      setAvailability('unavailable');
      return;
    }
    let current = true;
    recognizer.available!(ON_DEVICE).then(
      (status) => current && setAvailability(status),
      () => current && setAvailability('unavailable'),
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (recognition.current && text !== written.current) recognition.current.abort();
  }, [text]);

  useEffect(() => () => recognition.current?.abort(), []);

  async function start() {
    const recognizer = onDeviceRecognizer();
    if (!recognizer || recognition.current) return;
    setError(undefined);
    if (availability !== 'available') {
      // The language pack downloads once; the browser may ask the person first.
      setInstalling(true);
      const installed = await recognizer.install?.(ON_DEVICE).catch(() => false);
      setInstalling(false);
      const status = installed ? await recognizer.available!(ON_DEVICE) : 'unavailable';
      setAvailability(status);
      if (status !== 'available') return;
    }
    const session = new recognizer();
    session.lang = LANGUAGE;
    session.processLocally = true;
    session.continuous = true;
    session.interimResults = true;
    const before = text.trimEnd();
    written.current = text;
    session.onresult = ({ results }) => {
      const words = Array.from(results, (result) => result[0]?.transcript ?? '')
        .join('')
        .trim();
      written.current = [before, words].filter(Boolean).join(' ');
      setText(written.current);
    };
    session.onerror = ({ error: code }) => {
      if (code === 'service-not-allowed' || code === 'language-not-supported')
        setAvailability('unavailable');
      if (refusals[code]) setError(refusals[code]);
    };
    session.onend = () => {
      if (recognition.current === session) recognition.current = undefined;
      setListening(false);
    };
    recognition.current = session;
    setListening(true);
    session.start();
  }

  return {
    /** The browser offers on-device English recognition, installed or to install. */
    offered: availability !== undefined && availability !== 'unavailable',
    listening,
    installing,
    error,
    start: () => void start(),
    /** Stop listening; the recognizer still delivers the words it heard last. */
    stop: () => recognition.current?.stop(),
  };
}

export type Dictation = ReturnType<typeof useDictation>;

/**
 * The microphone button beside the message field. While it listens it shows a pulsing ring in the
 * primary color; with reduced motion the ring stays still.
 */
export function DictationButton({ dictation }: { dictation: Dictation }) {
  if (!dictation.offered) return null;
  const { listening, installing } = dictation;
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={listening ? 'Stop dictation' : 'Dictate'}
      aria-pressed={listening}
      title={installing ? 'Installing English speech recognition' : 'Dictate on this device'}
      disabled={installing}
      className={listening ? 'relative text-primary ring-2 ring-primary' : undefined}
      onClick={listening ? dictation.stop : dictation.start}
    >
      {listening && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-ping rounded-[inherit] ring-2 ring-primary motion-reduce:animate-none"
        />
      )}
      {installing ? <Loader2 className="animate-spin" aria-hidden /> : <Mic aria-hidden />}
    </Button>
  );
}
