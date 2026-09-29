export interface AudioHints {
  language?: string;
  min_speakers?: number | null;
  max_speakers?: number | null;
}

/**
 * Upload one file as a raw request body. XHR rather than fetch because fetch
 * still can't report upload progress, and a lesson recording takes a while.
 */
export function uploadFile(
  unitId: string,
  file: Blob,
  name: string,
  hints: AudioHints,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const qs = new URLSearchParams({ name });
  if (hints.language) qs.set("language", hints.language);
  if (hints.min_speakers) qs.set("min_speakers", String(hints.min_speakers));
  if (hints.max_speakers) qs.set("max_speakers", String(hints.max_speakers));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/units/${unitId}/upload?${qs}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `Fehler ${xhr.status}`;
      try {
        msg = JSON.parse(xhr.responseText).error ?? JSON.parse(xhr.responseText).message ?? msg;
      } catch { /* not JSON */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error("Verbindung abgebrochen"));
    xhr.send(file);
  });
}
