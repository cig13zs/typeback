import { DEFAULT_BLOCKLIST, normalizeBlockRule } from './blocklist';
import {
  DEFAULT_ENTRY_CAP,
  DEFAULT_MAX_VERSIONS,
  DEFAULT_RETENTION_DAYS,
  type Settings,
} from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function defaultSettings(): Settings {
  return {
    paused: false,
    retentionDays: DEFAULT_RETENTION_DAYS,
    blocklist: [...DEFAULT_BLOCKLIST],
    maxVersions: DEFAULT_MAX_VERSIONS,
    entryCap: DEFAULT_ENTRY_CAP,
  };
}

export function normalizeSettings(value: unknown): Settings {
  const defaults = defaultSettings();
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;
  const retention = Number(raw.retentionDays);
  const maxVersions = Number(raw.maxVersions);
  const entryCap = Number(raw.entryCap);
  const blocklist = Array.isArray(raw.blocklist)
    ? unique(
        raw.blocklist
          .map((item) => normalizeBlockRule(String(item)))
          .filter((item) => item.length > 0),
      )
    : defaults.blocklist;
  return {
    paused: raw.paused === true,
    retentionDays: Number.isFinite(retention)
      ? clamp(Math.round(retention), 0, 3650)
      : defaults.retentionDays,
    blocklist,
    maxVersions: Number.isFinite(maxVersions)
      ? clamp(Math.round(maxVersions), 1, 50)
      : defaults.maxVersions,
    entryCap: Number.isFinite(entryCap) ? clamp(Math.round(entryCap), 50, 5000) : defaults.entryCap,
  };
}
