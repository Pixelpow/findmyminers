/**
 * Device-name normaliser.
 *
 * Leaf module (no internal imports) so every driver can depend on it without
 * creating an import cycle with the driver registry.
 *
 * Add a new entry here when you add support for a new miner family so the UI
 * shows a clean, human-friendly model name instead of a raw firmware string.
 */

const KNOWN_DEVICES: [RegExp, string][] = [
  // NerdQAxe variants
  [/nerdqaxe\s*\+\+/i, 'NerdQAxe++'],
  [/nerdqaxe\s*plus/i, 'NerdQAxe+'],
  [/nerdqaxe/i, 'NerdQAxe'],
  // NerdOctaxe
  [/nerdoctaxe/i, 'NerdOctaxe'],
  // NerdAxe variants
  [/nerdaxe\s*\+\+/i, 'NerdAxe++'],
  [/nerdaxe/i, 'NerdAxe'],
  // Bitaxe variants (most specific first)
  [/bitaxe\s*supra/i, 'Bitaxe Supra'],
  [/bitaxe\s*ultra/i, 'Bitaxe Ultra'],
  [/bitaxe\s*hex/i, 'Bitaxe Hex'],
  [/bitaxe\s*max/i, 'Bitaxe Max'],
  [/bitaxe\s*gamma/i, 'Bitaxe Gamma'],
  [/bitaxe\s*gt/i, 'Bitaxe GT'],
  [/bitaxe\s*touch/i, 'Bitaxe Touch'],
  [/bitaxe/i, 'Bitaxe'],
  // Other open-source miners
  [/lucky\s*miner/i, 'Lucky Miner'],
  [/piaxe/i, 'PiAxe'],
  [/qaxe\s*\+\+/i, 'QAxe++'],
  [/qaxe\s*plus/i, 'QAxe+'],
  [/qaxe/i, 'QAxe'],
  [/jade\s*miner/i, 'Jade Miner'],
  // Avalon variants
  [/avalon\s*nano\s*3s?/i, 'Avalon Nano 3s'],
  [/avalon\s*nano/i, 'Avalon Nano'],
  [/avalon\s*mini\s*3/i, 'Avalon Mini 3'],
  [/avalon\s*mini/i, 'Avalon Mini'],
  [/avalon/i, 'Avalon'],
  // Antminers
  [/antminer\s*s21/i, 'Antminer S21'],
  [/antminer\s*s19/i, 'Antminer S19'],
  [/antminer\s*s17/i, 'Antminer S17'],
  [/antminer\s*t21/i, 'Antminer T21'],
  [/antminer/i, 'Antminer'],
  // Whatsminer
  [/whatsminer\s*m6\d/i, 'Whatsminer M6x'],
  [/whatsminer\s*m5\d/i, 'Whatsminer M5x'],
  [/whatsminer\s*m3\d/i, 'Whatsminer M3x'],
  [/whatsminer/i, 'Whatsminer'],
  // Goldshell / IceRiver (KAS/other)
  [/goldshell/i, 'Goldshell'],
  [/iceriver/i, 'IceRiver'],
];

/** Try to match a human-friendly device name from raw strings. */
export function normaliseName(...candidates: (string | undefined | null)[]): string | null {
  const haystack = candidates.filter(Boolean).join(' ');
  for (const [re, pretty] of KNOWN_DEVICES) {
    if (re.test(haystack)) return pretty;
  }
  return null;
}
