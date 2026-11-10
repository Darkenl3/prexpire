type Downloads = { save: (req: { filename: string; data: string }) => Promise<unknown> };
type ClaudeHost = { use: (name: 'downloads') => Promise<Downloads | null> };

// Downloads text as a file. Inside a claude.ai artifact (where plain downloads are blocked)
// the viewer's download prompt is used instead; declining it is not an error.
// Inside the iPhone app (window.__prexpireShareFile) the app writes the file
// and opens iPhone's share sheet: its web view can't download files, and
// its support for sharing files from the page is unreliable.
function shareThroughApp(fileName: string, text: string): Promise<void> | null {
  const w = window as { __prexpireShareFile?: number; ReactNativeWebView?: { postMessage?: (d: string) => void } };
  if (!w.__prexpireShareFile || !w.ReactNativeWebView?.postMessage) return null;
  return new Promise((resolve, reject) => {
    const requestId = `share-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ requestId?: string; error?: string }>).detail;
      if (d?.requestId !== requestId) return;
      window.removeEventListener('prexpire:share-file', on);
      if (d.error) reject(new Error(d.error));
      else resolve();
    };
    window.addEventListener('prexpire:share-file', on);
    try {
      w.ReactNativeWebView!.postMessage!(JSON.stringify({ type: 'share-file', requestId, name: fileName, text }));
    } catch (err) {
      window.removeEventListener('prexpire:share-file', on);
      reject(err);
    }
  });
}

export async function saveTextFile(fileName: string, mimeType: string, text: string) {
  const viaApp = typeof window !== 'undefined' ? shareThroughApp(fileName, text) : null;
  if (viaApp) return viaApp;
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
