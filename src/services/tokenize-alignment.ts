import type { CharacterAlignment } from '../types/elevenlabs.js';
import { assertAlignmentShape } from '../types/elevenlabs.js';

export type WordSpan = {
  text: string;
  startSec: number;
  endSec: number;
};

/**
 * Maps ElevenLabs character-level alignment to word-level spans.
 * MVP: split on whitespace — swap implementation for Vietnamese tokenizers later.
 */
export function tokenizeAlignment(alignment: CharacterAlignment): WordSpan[] {
  assertAlignmentShape(alignment);
  const { characters, character_start_times_seconds, character_end_times_seconds } =
    alignment;

  const words: WordSpan[] = [];
  let buf = '';
  let wordStart: number | null = null;
  let wordEnd: number | null = null;

  const flush = () => {
    if (buf.trim() === '' || wordStart === null || wordEnd === null) {
      buf = '';
      wordStart = null;
      wordEnd = null;
      return;
    }
    words.push({ text: buf.trim(), startSec: wordStart, endSec: wordEnd });
    buf = '';
    wordStart = null;
    wordEnd = null;
  };

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    const isSpace = /\s/.test(ch);

    if (isSpace) {
      flush();
      continue;
    }

    if (wordStart === null) wordStart = character_start_times_seconds[i];
    buf += ch;
    wordEnd = character_end_times_seconds[i];
  }
  flush();

  return words;
}
