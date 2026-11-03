type Downloads = { save: (req: { filename: string; data: string }) => Promise<unknown> };
type ClaudeHost = { use: (name: 'downloads') => Promise<Downloads | null> };

// Downloads text as a file. Inside a claude.ai artifact (where plain downloads are blocked)
// the viewer's download prompt is used instead; declining it is not an error.
export async function saveTextFile(fileName: string, mimeType: string, text: string) {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  const downloads = host?.use ? await host.use('downloads') : null;
  if (downloads) {
    try {
      await downloads.save({ filename: fileName, data: text });
    } catch (e) {
      if ((e as { code?: string })?.code !== 'declined') throw e;
    }
    return;
  }

  // On a phone (and inside the iOS app, whose web view ignores downloads) the
  // system share sheet saves the file: "Save to Files", AirDrop, Mail.
  // Desktop browsers keep the plain download below.
  const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  if (touch && typeof navigator.canShare === 'function' && typeof File !== 'undefined') {
    const file = new File([text], fileName, { type: mimeType });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        if ((e as { name?: string })?.name !== 'AbortError') throw e;
      }
      return;
    }
  }

  // The object URL is released once the download has started.
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
