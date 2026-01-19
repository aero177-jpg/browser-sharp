import { loadCloudGpuSettings } from './storage/cloudGpuSettings.js';


export async function testSharpCloud(files, { prefix, onProgress, apiUrl, apiKey } = {}) {
  const saved = loadCloudGpuSettings();
  const resolvedUrl = apiUrl || saved?.apiUrl 
  const resolvedKey = apiKey || saved?.apiKey 

  if (!resolvedUrl || !resolvedKey) {
    console.error('❌ Missing Cloud GPU settings: configure API URL and API key in Add Cloud GPU.');
    return [];
  }

  if (!files || files.length === 0) {
    console.warn("No files selected for upload.");
    return [];
  }

  const uploads = Array.from(files);
  const results = [];
  const total = uploads.length;

  for (const file of uploads) {
    console.log(`🚀 Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append("file", file, file.name || "upload");
      if (prefix) {
        formData.append("prefix", prefix);
      }

      const response = await fetch(resolvedUrl, {
        method: "POST",
        headers: {
          "X-API-KEY": resolvedKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server responded with ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`✅ Success for ${file.name}:`, result.url);
      results.push({ file: file.name, ok: true, data: result });
    } catch (err) {
      console.error(`❌ Upload failed for ${file.name}:`, err.message);
      results.push({ file: file.name, ok: false, error: err.message });
    }

    if (typeof onProgress === 'function') {
      onProgress({ completed: results.length, total });
    }
  }

  return results;
}
