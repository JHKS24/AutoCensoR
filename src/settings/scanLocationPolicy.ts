import { RunConfig } from '../engine/EngineAdapter';

export type OutputRootPolicy = 'input-parent' | 'custom';

export const isOutputRootPolicy = (value: unknown): value is OutputRootPolicy =>
  value === 'input-parent' || value === 'custom';

const trimPath = (path: string): string => String(path || '').trim();

const stripTrailingSeparators = (path: string): string => {
  const trimmed = trimPath(path);
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) return trimmed.replace('/', '\\');
  if (trimmed === '/' || trimmed === '\\') return trimmed;
  if (/^[/\\]{2}[^/\\]+[/\\][^/\\]+[/\\]?$/.test(trimmed)) {
    return trimmed.replace(/[\\/]+$/, '');
  }
  return trimmed.replace(/[\\/]+$/, '');
};

export const deriveParentDirectory = (path: string): string => {
  const normalized = stripTrailingSeparators(path);
  if (!normalized) return '';
  if (/^[A-Za-z]:[\\/]?$/.test(normalized)) return normalized.replace('/', '\\');
  if (normalized === '/' || normalized === '\\') return normalized;

  const uncMatch = normalized.match(/^([/\\]{2}[^/\\]+[/\\][^/\\]+)([/\\].*)?$/);
  if (uncMatch && !uncMatch[2]) return uncMatch[1];

  const slashIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  if (slashIndex < 0) return '';
  if (/^[A-Za-z]:/.test(normalized) && slashIndex === 2) return normalized.slice(0, 3);
  if (slashIndex === 0) return '/';
  if (uncMatch && slashIndex <= uncMatch[1].length) return uncMatch[1];
  return normalized.slice(0, slashIndex);
};

export const folderNameOf = (path: string): string => {
  const normalized = stripTrailingSeparators(path);
  if (!normalized || normalized === '/' || /^[A-Za-z]:[\\/]?$/.test(normalized)) return '';
  const slashIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
};

export const joinPath = (...parts: string[]): string => {
  const separator = parts.some((part) => part.includes('\\')) ? '\\' : '/';
  const cleaned = parts
    .filter(Boolean)
    .map((part, index) => index === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, ''));
  return cleaned.join(separator);
};

export const normalizePathForCompare = (path: string): string => {
  const normalized = stripTrailingSeparators(path).replace(/\//g, '\\');
  return /^[A-Za-z]:/.test(normalized) || normalized.startsWith('\\\\')
    ? normalized.toLowerCase()
    : normalized;
};

export const pathsEqual = (left: string, right: string): boolean =>
  normalizePathForCompare(left) === normalizePathForCompare(right);

export const inferOutputRootPolicy = (
  rawPolicy: unknown,
  rawOutputDirs: unknown,
  inputDir: string,
  defaultOutputDir = 'output'
): OutputRootPolicy => {
  if (isOutputRootPolicy(rawPolicy)) return rawPolicy;
  const dirs = Array.isArray(rawOutputDirs)
    ? rawOutputDirs.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  if (dirs.length === 0 || pathsEqual(dirs[0], defaultOutputDir)) return 'input-parent';
  const parent = deriveParentDirectory(inputDir);
  if (parent && pathsEqual(dirs[0], parent)) return 'input-parent';
  return 'custom';
};

export const resolveScanRunConfig = (
  runConfig: RunConfig,
  inputDir: string,
  outputRootPolicy: OutputRootPolicy
): RunConfig => {
  const committedInput = trimPath(inputDir);
  if (outputRootPolicy !== 'input-parent') {
    return { ...runConfig, input_dir: committedInput };
  }
  const parent = deriveParentDirectory(committedInput);
  const outputDirs = parent
    ? Array.from(new Set([parent, ...runConfig.output_dirs.slice(1)]))
    : runConfig.output_dirs;
  return {
    ...runConfig,
    input_dir: committedInput,
    output_dirs: outputDirs
  };
};
