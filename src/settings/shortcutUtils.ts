const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

const FIXED_SHORTCUTS: Record<string, string> = {
  fixedCanvasPan: 'Space'
};

const KEY_ALIASES: Record<string, string> = {
  control: 'Ctrl',
  ctrl: 'Ctrl',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  cmd: 'Meta',
  command: 'Meta',
  meta: 'Meta',
  win: 'Meta',
  escape: 'Escape',
  esc: 'Escape',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  pgup: 'PageUp',
  pageup: 'PageUp',
  pgdn: 'PageDown',
  pgdown: 'PageDown',
  pagedown: 'PageDown',
  space: 'Space',
  ' ': 'Space',
  spacebar: 'Space',
  home: 'Home',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  '[': '[',
  ']': ']'
};

const normalizeKeyName = (key: string): string => {
  const trimmed = key.trim();
  const lower = trimmed.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^\d$/.test(trimmed)) return trimmed;
  if (trimmed.length === 1) return trimmed.toUpperCase();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() + trimmed.slice(1) : '';
};

export const normalizeShortcut = (shortcut: string): string => {
  const raw = String(shortcut || '').trim();
  if (!raw) return '';

  const modifiers = new Set<string>();
  const keys: string[] = [];

  raw.split('+').map(part => part.trim()).filter(Boolean).forEach((part) => {
    const normalized = normalizeKeyName(part);
    if (MODIFIER_ORDER.includes(normalized as typeof MODIFIER_ORDER[number])) {
      modifiers.add(normalized);
      return;
    }
    keys.push(normalized);
  });

  const orderedModifiers = MODIFIER_ORDER.filter(modifier => modifiers.has(modifier));
  const key = keys[keys.length - 1] || '';
  return [...orderedModifiers, key].filter(Boolean).join('+');
};

export const normalizeShortcutList = (shortcut: string): string => {
  const normalized = String(shortcut || '')
    .split(/[,;\n]/)
    .map((item) => normalizeShortcut(item))
    .filter(Boolean);
  return Array.from(new Set(normalized)).join(', ');
};

export const shortcutFromKeyboardEvent = (event: KeyboardEvent): string => {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  parts.push(normalizeKeyName(event.key === ' ' ? 'Space' : event.key));
  return normalizeShortcut(parts.join('+'));
};

export const shortcutMatches = (event: KeyboardEvent, shortcut: string): boolean => {
  const normalized = normalizeShortcutList(shortcut);
  if (!normalized) return false;
  const pressed = shortcutFromKeyboardEvent(event);
  return normalized.split(',').map((item) => item.trim()).filter(Boolean).includes(pressed);
};

export const findShortcutConflicts = <T extends object>(shortcuts: T): Record<string, string[]> => {
  const buckets = new Map<string, string[]>();
  Object.entries({ ...FIXED_SHORTCUTS, ...(shortcuts as Record<string, string>) }).forEach(([key, value]) => {
    normalizeShortcutList(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((normalized) => {
        buckets.set(normalized, Array.from(new Set([...(buckets.get(normalized) || []), key])));
      });
  });

  const conflicts: Record<string, string[]> = {};
  buckets.forEach((keys) => {
    if (keys.length < 2) return;
    keys.forEach((key) => {
      if (key.startsWith('fixed')) return;
      conflicts[key] = keys.filter(item => item !== key);
    });
  });
  return conflicts;
};
