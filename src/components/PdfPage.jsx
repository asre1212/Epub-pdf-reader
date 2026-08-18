import { memo, useEffect, useRef } from 'react';
import { TextLayer } from '../lib/pdf.js';
import { colorHex } from '../lib/highlightColors.js';

/**
 * One page: a canvas, a selectable text layer on top, and the highlight boxes
 * painted underneath the text so selection keeps working.
 */
function PdfPage({ pdf, pageNumber, scale, width, height, active, highlights, onSized, invert }) {
  const canvasRef = useRef(null);
  const textRef = useRef(null);
  const taskRef = useRef(null);
  const renderedRef = useRef(null); // scale the current canvas was drawn at

  useEffect(() => {
    let cancelled = false;

    if (!active) {
      // Drop the bitmap for pages that scrolled away; a long PDF otherwise
      // holds on to hundreds of megabytes of canvas.
      taskRef.current?.cancel();
      taskRef.current = null;
      renderedRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      if (textRef.current) textRef.current.replaceChildren();
      return undefined;
    }

    if (renderedRef.current === scale) return undefined;

    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        onSized(pageNumber, page.getViewport({ scale: 1 }));

        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const canvasContext = canvas.getContext('2d', { alpha: false });
        canvasContext.save();
        canvasContext.fillStyle = '#ffffff';
        canvasContext.fillRect(0, 0, canvas.width, canvas.height);
        canvasContext.restore();

        taskRef.current = page.render({
          canvasContext,
          viewport,
          transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
        });
        await taskRef.current.promise;
        taskRef.current = null;
        if (cancelled) return;
        renderedRef.current = scale;

        const layer = textRef.current;
        if (layer) {
          layer.replaceChildren();
          const textLayer = new TextLayer({
            textContentSource: page.streamTextContent({ includeMarkedContent: true }),
            container: layer,
            viewport,
          });
          await textLayer.render();
        }
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') console.warn('Page render failed', err);
      }
    })();

    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      taskRef.current = null;
    };
  }, [pdf, pageNumber, scale, active, onSized]);

  return (
    <div
      className={invert ? 'pdf-page is-inverted' : 'pdf-page'}
      data-page={pageNumber}
      style={{ width: `${width}px`, height: `${height}px`, '--scale-factor': scale }}
    >
      <canvas ref={canvasRef} className={invert ? 'pdf-canvas pdf-invert' : 'pdf-canvas'} />

      <div className="pdf-marks" aria-hidden="true">
        {highlights.map((highlight) =>
          highlight.rects
            .filter((rect) => rect.p === pageNumber)
            .map((rect, index) => (
              <span
                key={`${highlight.id}-${index}`}
                className="pdf-mark"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  background: colorHex(highlight.color),
                }}
              />
            )),
        )}
      </div>

      <div ref={textRef} className="textLayer" />
      <span className="pdf-page-number" aria-hidden="true">
        {pageNumber}
      </span>
    </div>
  );
}

export default memo(PdfPage);
