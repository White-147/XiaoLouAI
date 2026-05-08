export type FeaturePresetName = 'full' | 'core';

export type RuntimeFeatureFlags = {
  workflows: boolean;
  history: boolean;
  assets: boolean;
  text: boolean;
  image: boolean;
  video: boolean;
  imageEditor: boolean;
  videoEditor: boolean;
  chat: boolean;
  socialShare: boolean;
  tiktokImport: boolean;
  storyboard: boolean;
  localModels: boolean;
  cameraAngle: boolean;
};

export type RuntimeConfig = {
  isEmbedded: boolean;
  featurePreset: FeaturePresetName;
  features: RuntimeFeatureFlags;
};

type RuntimeWindow = Window & {
  __TWITCANVA_ENV__?: Record<string, string | undefined>;
};

const FULL_FEATURES: RuntimeFeatureFlags = {
  workflows: true,
  history: true,
  assets: true,
  text: true,
  image: true,
  video: true,
  imageEditor: true,
  videoEditor: true,
  chat: true,
  socialShare: true,
  tiktokImport: true,
  storyboard: true,
  localModels: true,
  cameraAngle: true,
};

const CORE_FEATURES: RuntimeFeatureFlags = {
  workflows: true,
  history: true,
  assets: true,
  text: true,
  image: true,
  video: true,
  imageEditor: true,
  videoEditor: true,
  chat: false,
  socialShare: false,
  tiktokImport: false,
  storyboard: false,
  localModels: false,
  cameraAngle: false,
};

const FEATURE_PRESETS: Record<FeaturePresetName, RuntimeFeatureFlags> = {
  full: FULL_FEATURES,
  core: CORE_FEATURES,
};

function parseFeatureOverride(value: string | null): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

export function getRuntimeConfig(search = typeof window !== 'undefined' ? window.location.search : ''): RuntimeConfig {
  const params = new URLSearchParams(search);
  const featurePreset = params.get('featurePreset') === 'core' ? 'core' : 'full';
  const isEmbedded = ['1', 'true', 'yes'].includes((params.get('embed') || '').toLowerCase());
  const cameraAngleOverride = parseFeatureOverride(params.get('cameraAngle'));
  const features = { ...FEATURE_PRESETS[featurePreset] };

  if (cameraAngleOverride !== undefined) {
    features.cameraAngle = cameraAngleOverride;
  }

  return {
    isEmbedded,
    featurePreset,
    features,
  };
}

/**
 * Returns a RuntimeConfig suitable for direct-embed mode (no iframe).
 * Matches the feature set used when CanvasCreate.tsx loaded the canvas via
 * iframe with ?featurePreset=core&cameraAngle=1.
 */
export function getDirectEmbedRuntimeConfig(): RuntimeConfig {
  return {
    isEmbedded: false, // keep false so postMessage effects stay disabled
    featurePreset: 'core',
    features: { ...CORE_FEATURES, chat: true, cameraAngle: true },
  };
}

export function getRuntimeEnvValue(name: string): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const value = (window as RuntimeWindow).__TWITCANVA_ENV__?.[name];
  return typeof value === 'string' ? value : '';
}
