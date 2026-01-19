/**
 * Cloud GPU settings persistence
 * Stores API URL and API Key for the image conversion service.
 */

const STORAGE_KEY = 'cloud-gpu-settings';

export const loadCloudGpuSettings = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.apiUrl || !parsed.apiKey) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const saveCloudGpuSettings = (settings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
};

export const clearCloudGpuSettings = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};
