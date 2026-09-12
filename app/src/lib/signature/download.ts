/** Save a blob to the user's device. Nothing is uploaded anywhere. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke on the next frame so Safari has time to start the download.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

export function downloadText(text: string, fileName: string, mimeType: string): void {
  downloadBlob(new Blob([text], { type: mimeType }), fileName);
}

/**
 * Turn a typed name into a file name.
 *
 * The name is the user's, so it decides what the file is called — but it
 * reaches a file system, and a file system is less forgiving than a text input.
 * Anything that could be read as a path separator, a device name or a shell
 * surprise is replaced rather than stripped, so two different names cannot
 * collapse into the same file.
 */
export function fileNameFor(text: string, extension: string): string {
  const stem = text
    .normalize('NFKD')
    // Combining marks, left behind by the decomposition above: this is what
    // turns "Jiří" into "jiri" rather than "ji".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();

  return stem ? `${stem}-signature.${extension}` : `signature.${extension}`;
}
