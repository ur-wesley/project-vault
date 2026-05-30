import {
  type Component,
  createSignal,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import { useI18n } from "~/lib/i18n-context";

interface RegionSelectorProps {
  screenImageData: Uint8Array;
  onSelect: (croppedImageData: Uint8Array) => void;
  onCancel: () => void;
}

const RegionSelector: Component<RegionSelectorProps> = (props) => {
  const { t } = useI18n();
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let bgCanvasRef: HTMLCanvasElement | undefined;
  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let overlayCanvasRef: HTMLCanvasElement | undefined;

  const [isDragging, setIsDragging] = createSignal(false);
  const [startX, setStartX] = createSignal(0);
  const [startY, setStartY] = createSignal(0);
  const [endX, setEndX] = createSignal(0);
  const [endY, setEndY] = createSignal(0);

  // eslint-disable-next-line no-unassigned-vars — Solid ref pattern
  let imageRef: HTMLImageElement | undefined;

  const drawOverlay = () => {
    if (!overlayCanvasRef || !imageRef) return;
    const ctx = overlayCanvasRef.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayCanvasRef.width, overlayCanvasRef.height);

    // Dark overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, overlayCanvasRef.width, overlayCanvasRef.height);

    if (isDragging()) {
      const x = Math.min(startX(), endX());
      const y = Math.min(startY(), endY());
      const w = Math.abs(endX() - startX());
      const h = Math.abs(endY() - startY());

      // Clear the selected region (make it transparent to show the background)
      ctx.clearRect(x, y, w, h);

      // Border
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      // Size label
      ctx.fillStyle = "rgba(59, 130, 246, 0.9)";
      const label = `${Math.round(w)} × ${Math.round(h)}`;
      ctx.font = "12px sans-serif";
      const metrics = ctx.measureText(label);
      const labelX = x + (w - metrics.width) / 2;
      const labelY = y + h + 20;
      ctx.fillRect(labelX - 4, labelY - 12, metrics.width + 8, 18);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, labelX, labelY);
    }
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setStartX(e.clientX);
    setStartY(e.clientY);
    setEndX(e.clientX);
    setEndY(e.clientY);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return;
    setEndX(e.clientX);
    setEndY(e.clientY);
    drawOverlay();
  };

  const handleMouseUp = () => {
    if (!isDragging()) return;
    setIsDragging(false);

    const x = Math.min(startX(), endX());
    const y = Math.min(startY(), endY());
    const w = Math.abs(endX() - startX());
    const h = Math.abs(endY() - startY());

    if (w < 5 || h < 5) {
      // Too small, ignore
      drawOverlay();
      return;
    }

    // Crop the region from the background image
    if (!bgCanvasRef || !imageRef) return;

    const scale = bgCanvasRef.width / window.innerWidth;
    const cropX = x * scale;
    const cropY = y * scale;
    const cropW = w * scale;
    const cropH = h * scale;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) return;

    cropCtx.drawImage(imageRef, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Convert to PNG Uint8Array
    const dataUrl = cropCanvas.toDataURL("image/png");
    const base64 = dataUrl.split(",")[1];
    if (!base64) return;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    props.onSelect(bytes);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onCancel();
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);

    const img = new Image();
    img.onload = () => {
      imageRef = img;

      if (bgCanvasRef && overlayCanvasRef) {
        bgCanvasRef.width = window.innerWidth;
        bgCanvasRef.height = window.innerHeight;
        overlayCanvasRef.width = window.innerWidth;
        overlayCanvasRef.height = window.innerHeight;

        const bgCtx = bgCanvasRef.getContext("2d");
        if (bgCtx) {
          bgCtx.drawImage(img, 0, 0, window.innerWidth, window.innerHeight);
        }
        drawOverlay();
      }
    };
    const blob = new Blob([props.screenImageData], { type: "image/png" });
    img.src = URL.createObjectURL(blob);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div
      class="fixed inset-0 z-50 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <canvas
        ref={bgCanvasRef}
        class="absolute inset-0"
      />
      <canvas
        ref={overlayCanvasRef}
        class="absolute inset-0"
      />
      <Show when={!isDragging()}>
        <div class="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-background/90 px-4 py-2 text-sm text-muted-foreground shadow-lg backdrop-blur-sm">
          {t("screenshot.selectRegionDesc")}
          <span class="ml-2 text-xs opacity-60">ESC</span>
        </div>
      </Show>
    </div>
  );
};

export default RegionSelector;
