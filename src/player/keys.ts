/**
 * Stage 3d §8.3: what the HUD key strip calls a key, by id (data; the UI draws it — W2a). A key without an entry is
 * shown by its id in capitals. Level 1–5 keys keep their own names where the UI already has them (`keycard` →
 * `LevelInfo.keycardName`).
 */
export const KEY_NAMES: Readonly<Record<string, string>> = {
  key6_a: 'KEY A — HEAD-END',
  key6_b: 'KEY B — MOON POOL',
};

export function keyName(id: string): string {
  return KEY_NAMES[id] ?? id.replace(/_/g, ' ').toUpperCase();
}
