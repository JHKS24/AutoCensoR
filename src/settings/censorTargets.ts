export interface CensorTargetGroup {
  id: string;
  label: {
    en: string;
    ko: string;
  };
  description: {
    en: string;
    ko: string;
  };
  sfwLabel: {
    en: string;
    ko: string;
  };
  sfwDescription: {
    en: string;
    ko: string;
  };
  labels: string[];
}

// Fixed default targets for the NTD anime NSFW segmentation label set used by
// the legacy AutoCensor release. Users can add model-specific labels for other
// models, but these defaults are always included in selected-target mode.
export const CENSOR_TARGET_GROUPS: CensorTargetGroup[] = [
  {
    id: 'ntd-anus',
    label: {
      en: 'Anus',
      ko: '항문 (Anus)'
    },
    description: {
      en: 'NTD labels: anus, anal, ass, asshole, exposed_anus, buttocks.',
      ko: 'NTD 라벨: anus, anal, ass, asshole, exposed_anus, buttocks.'
    },
    sfwLabel: {
      en: 'Protected category 1',
      ko: '보호 범주 1'
    },
    sfwDescription: {
      en: 'Exact default target labels are hidden in protected display.',
      ko: '보호 표시 상태에서는 정확한 기본 대상 라벨을 숨깁니다.'
    },
    labels: ['anus', 'anal', 'ass', 'asshole', 'exposed_anus', 'buttocks']
  },
  {
    id: 'ntd-genitals',
    label: {
      en: 'Genitals',
      ko: '성기 (Genitals)'
    },
    description: {
      en: 'NTD labels: penis, exposed_penis, genitalia, genitals, vulva, vagina, pussy, exposed_vulva, testicles, cunnus, female_genital.',
      ko: 'NTD 라벨: penis, exposed_penis, genitalia, genitals, vulva, vagina, pussy, exposed_vulva, testicles, cunnus, female_genital.'
    },
    sfwLabel: {
      en: 'Protected category 2',
      ko: '보호 범주 2'
    },
    sfwDescription: {
      en: 'Exact default target labels are hidden in protected display.',
      ko: '보호 표시 상태에서는 정확한 기본 대상 라벨을 숨깁니다.'
    },
    labels: ['penis', 'exposed_penis', 'genitalia', 'genitals', 'vulva', 'vagina', 'pussy', 'exposed_vulva', 'testicles', 'cunnus', 'female_genital']
  },
  {
    id: 'ntd-breast-nipple',
    label: {
      en: 'Breast / nipple',
      ko: '가슴 (Breast/Nipple)'
    },
    description: {
      en: 'NTD labels: nipple, nipples, exposed_nipple, breast, exposed_breast.',
      ko: 'NTD 라벨: nipple, nipples, exposed_nipple, breast, exposed_breast.'
    },
    sfwLabel: {
      en: 'Protected category 3',
      ko: '보호 범주 3'
    },
    sfwDescription: {
      en: 'Exact default target labels are hidden in protected display.',
      ko: '보호 표시 상태에서는 정확한 기본 대상 라벨을 숨깁니다.'
    },
    labels: ['nipple', 'nipples', 'exposed_nipple', 'breast', 'exposed_breast']
  }
];

export const DEFAULT_CENSOR_TARGETS = CENSOR_TARGET_GROUPS.flatMap((group) => group.labels);
export const DEFAULT_CENSOR_TARGET_SET = new Set(DEFAULT_CENSOR_TARGETS);

// A previous vNext candidate accidentally used generic privacy-demo targets as
// defaults. Remove them only when an old saved setting clearly contains that
// full broken default set; future user-added model labels must remain editable.
export const LEGACY_GENERIC_DEFAULT_TARGETS = [
  'nsfw',
  'adult',
  'face',
  'person',
  'license_plate',
  'license',
  'text',
  'document',
  'stamp',
  'logo'
];
export const LEGACY_GENERIC_DEFAULT_TARGET_SET = new Set(LEGACY_GENERIC_DEFAULT_TARGETS);

// Legacy builds stored targets as 64-char SHA-256 hashes. Those are no longer a
// privacy mechanism; detect them so saved settings can migrate to readable labels.
export const LEGACY_HASHED_TARGET_PATTERN = /^[a-f0-9]{64}$/i;

export const isLegacyHashedTarget = (value: string): boolean =>
  LEGACY_HASHED_TARGET_PATTERN.test(String(value || '').trim());

export const maskPrivacyName = (name: string): string => {
  if (!name) return name;
  const dotIndex = name.lastIndexOf('.');
  const ext = dotIndex > 0 ? name.slice(dotIndex) : '';
  return `Private image${ext}`;
};

// Redacts genuinely private material (absolute filesystem paths and model weight
// file references) from diagnostic text. Public-safe labels/aliases are left
// readable; this no longer blanket-masks every 64-hex string.
export const maskSensitiveText = (text: string, replacement = 'Protected content'): string => {
  if (!text) return '';
  let masked = text;
  // UNC paths such as \\server\share\private model.pt.
  masked = masked.replace(/\\\\[^"'`\r\n]+/g, replacement);
  // Drive-letter paths such as C:\folder\file or D:/folder/file.
  masked = masked.replace(/[A-Za-z]:[\\/][^"'`\r\n]+/g, replacement);
  // POSIX-style absolute paths that include model weights or common private roots.
  masked = masked.replace(/(?:\/Users|\/home|\/mnt|\/Volumes)\/[^"'`\r\n]+/g, replacement);
  // Model weight file references that could reveal private filenames.
  masked = masked.replace(/[^\r\n"'`]+?\.(?:pt|pth|onnx|engine|safetensors)\b/gi, replacement);
  return masked;
};
