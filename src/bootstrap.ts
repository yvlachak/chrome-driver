import os from 'node:os';

export type CompatibilityMode = 'auto' | 'native' | 'force';

export interface HostDiagnostics {
  platform: NodeJS.Platform;
  release: string;
  arch: string;
  totalMemoryGiB: number;
  logicalCpuCount: number;
}

export interface BootstrapInfo {
  requestedMode: CompatibilityMode;
  activeMode: 'native' | 'compat';
  nativeAvailability: string;
  finalAvailability: string;
  host: HostDiagnostics;
}

const PERFORMANCE_OVERRIDE_FEATURE =
  'OnDeviceModelPerformanceParams:compatible_on_device_performance_classes/*/compatible_low_tier_on_device_performance_classes/*';

const PERFORMANCE_REFRESH_FEATURE = 'OnDeviceModelFetchPerformanceClassEveryStartup';

export function hostDiagnostics(): HostDiagnostics {
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    totalMemoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    logicalCpuCount: os.cpus().length,
  };
}

export function chromeLaunchArgs(useCompatibilityOverride: boolean): string[] {
  const args = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
  ];

  if (useCompatibilityOverride) {
    // Mirrors Chromium's "Force Small Model" / BypassPerfRequirement flag
    // parameters without disabling the text-safety classifier.
    args.push(
      `--enable-features=${PERFORMANCE_OVERRIDE_FEATURE},${PERFORMANCE_REFRESH_FEATURE}`,
    );
  }

  return args;
}

export function parseCompatibilityMode(value: string | undefined): CompatibilityMode {
  if (!value || value === 'auto') return 'auto';
  if (value === 'native' || value === 'force') return value;
  throw new Error(`Invalid --compat-mode ${value}. Expected auto, native, or force.`);
}
