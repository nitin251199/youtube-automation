import type { Item } from './types.js';

const FEMALE = /\b(female|woman|women|girl|lady|mother|grandmother|wife|daughter|widow|she|her)\b|औरत|महिला|स्त्री|लड़की|बूढ़ी|माँ|दादी|नानी/;
const OLD = /\b(older|elder|elderly|aged|senior|mature|grandmother|grandfather)\b|(?<!year-|years )\bold (?:man|woman|lady)\b|बूढ़|वृद्ध|दादी|दादा|नानी|नाना/;
const YOUNG = /\b(young|youthful|child|kid|boy|girl|teen|teenage|teenager)\b|बच्च|लड़का|लड़की/;

/** A built-in Flow voice chosen from the described gender and age; no custom voices are created. */
export function voiceFor(description: string): string {
  const text = description.toLowerCase();
  const age = Number(/\b(\d{1,2})(?:\s*-?\s*(?:years?|yrs?)\b|s\b)/.exec(text)?.[1] ?? 0);
  const old = age >= 55 || OLD.test(text);
  const young = (age > 0 && age <= 17) || YOUNG.test(text);
  if (FEMALE.test(text)) return old ? 'Gacrux' : young ? 'Leda' : 'Despina';
  return old ? 'Algenib' : young ? 'Fenrir' : 'Iapetus';
}

export function describeCharacter(item: Item): string {
  return [item.voice_description, item.look_summary].filter(Boolean).join(' ');
}

/** Flow's character info field, which its agent reads when it writes scenes with the character. */
export function characterInfo(item: Item): string {
  return [item.look_summary, item.voice_description && `Voice: ${item.voice_description}`, 'Speaks Hindi with a native North Indian accent.']
    .filter(Boolean).join('\n').slice(0, 1500);
}
