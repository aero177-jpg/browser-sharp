const API_URL = import.meta.env.VITE_SHARP_API_URL;
const API_KEY = import.meta.env.VITE_SHARP_API_KEY;

export async function testSharpCloud(files, { prefix } = {}) {
  if (!API_URL || !API_KEY) {
    console.error("❌ Missing API config: set VITE_SHARP_API_URL and VITE_SHARP_API_KEY");
    return [];
  }

  if (!files || files.length === 0) {
    console.warn("No files selected for upload.");
    return [];
  }

  const uploads = Array.from(files);
  const results = [];

  for (const file of uploads) {
    console.log(`🚀 Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append("file", file, file.name || "upload");
      if (prefix) {
        formData.append("prefix", prefix);
      }

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "X-API-KEY": API_KEY,
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
  }

  return results;
}
