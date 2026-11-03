export function loadSpriteImage(
  source: string,
  {
    signal,
    timeoutMs = 8000,
    createImage = () => new Image(),
  }: { signal?: AbortSignal; timeoutMs?: number; createImage?: () => HTMLImageElement } = {},
): Promise<HTMLImageElement> {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const image = createImage();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = "";
        reject(error);
      } else resolve(image);
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Artwork download timed out")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    image.decoding = "async";
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        finish(new Error("Artwork was empty"));
      } else if (typeof image.decode === "function") {
        void image.decode().catch(() => {}).then(() => finish());
      } else finish();
    };
    image.onerror = () => finish(new Error("Artwork download failed"));
    image.src = source;
  });
}
