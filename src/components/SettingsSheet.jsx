import { HIGHLIGHT_COLORS } from '../lib/highlightColors.js';
import { THEMES } from '../lib/settings.js';

function Row({ label, value, children }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {value != null && <span className="set-value">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'seg is-on' : 'seg'}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsSheet({ format, settings, onChange, onDiagnostics, onClose }) {
  const isEpub = format === 'epub';
  const set = (patch) => onChange(patch);

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Reading settings"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <h2 className="sheet-title">Reading settings</h2>

        <Row label="Theme">
          <div className="theme-row" role="group" aria-label="Theme">
            {Object.entries(THEMES).map(([id, theme]) => (
              <button
                key={id}
                type="button"
                className={settings.theme === id ? 'theme-chip is-on' : 'theme-chip'}
                style={{ background: theme.bg, color: theme.fg }}
                onClick={() => set({ theme: id })}
                aria-pressed={settings.theme === id}
              >
                {theme.name}
              </button>
            ))}
          </div>
        </Row>

        <Row label="How pages scroll">
          <Segmented
            label="Page scrolling"
            value={settings.flow}
            onChange={(flow) => set({ flow })}
            options={[
              { value: 'paginated', label: isEpub ? 'Page turns' : 'Snap to page' },
              { value: 'scrolled', label: 'Continuous scroll' },
            ]}
          />
          <p className="set-hint">
            {isEpub
              ? settings.flow === 'paginated'
                ? 'Tap the left or right edge, swipe, or use the arrow keys.'
                : 'One long column you scroll through, chapter after chapter.'
              : settings.flow === 'paginated'
                ? 'Scrolling settles on one page at a time.'
                : 'Pages run together in one continuous scroll.'}
          </p>
        </Row>

        {isEpub && settings.flow === 'paginated' && (
          <label className="toggle toggle-row">
            <input
              type="checkbox"
              checked={settings.pageAnimation !== false}
              onChange={(e) => set({ pageAnimation: e.target.checked })}
            />
            <span>Animate page turns</span>
          </label>
        )}

        {isEpub ? (
          <>
            <Row label="Text size" value={`${settings.fontSize}%`}>
              <input
                type="range"
                min="70"
                max="260"
                step="5"
                value={settings.fontSize}
                onChange={(e) => set({ fontSize: Number(e.target.value) })}
              />
            </Row>

            <Row label="Line spacing" value={settings.lineHeight.toFixed(2)}>
              <input
                type="range"
                min="1"
                max="2.4"
                step="0.05"
                value={settings.lineHeight}
                onChange={(e) => set({ lineHeight: Number(e.target.value) })}
              />
            </Row>

            <Row label="Typeface">
              <Segmented
                label="Typeface"
                value={settings.fontFamily}
                onChange={(fontFamily) => set({ fontFamily })}
                options={[
                  { value: 'serif', label: 'Serif' },
                  { value: 'sans', label: 'Sans' },
                  { value: 'publisher', label: "Book's own" },
                ]}
              />
            </Row>

            <Row label="Letter spacing" value={`${settings.letterSpacing.toFixed(1)}px`}>
              <input
                type="range"
                min="-0.5"
                max="2"
                step="0.1"
                value={settings.letterSpacing}
                onChange={(e) => set({ letterSpacing: Number(e.target.value) })}
              />
            </Row>

            <label className="toggle toggle-row">
              <input
                type="checkbox"
                checked={settings.justify}
                onChange={(e) => set({ justify: e.target.checked })}
              />
              <span>Justify text</span>
            </label>
          </>
        ) : (
          <>
            <Row label="Zoom" value={`${Math.round(settings.pdfZoom * 100)}%`}>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.05"
                value={settings.pdfZoom}
                onChange={(e) => set({ pdfZoom: Number(e.target.value) })}
              />
            </Row>

            <Row label="Fit">
              <Segmented
                label="Page fit"
                value={settings.pdfFit}
                onChange={(pdfFit) => set({ pdfFit })}
                options={[
                  { value: 'width', label: 'Fit width' },
                  { value: 'page', label: 'Fit page' },
                ]}
              />
              <p className="set-hint">Zoom is applied on top of the fit, so 100% fills the fit exactly.</p>
            </Row>
          </>
        )}

        <Row label="Margin" value={`${settings.margin}%`}>
          <input
            type="range"
            min="0"
            max="22"
            step="1"
            value={settings.margin}
            onChange={(e) => set({ margin: Number(e.target.value) })}
          />
        </Row>

        <Row label="Default highlight colour">
          <div className="swatch-row swatch-row-lg" role="group" aria-label="Default highlight colour">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                className={settings.defaultColor === color.id ? 'swatch swatch-lg is-on' : 'swatch swatch-lg'}
                style={{ '--swatch': color.hex }}
                onClick={() => set({ defaultColor: color.id })}
                title={color.label}
                aria-label={color.label}
                aria-pressed={settings.defaultColor === color.id}
              />
            ))}
          </div>
        </Row>

        <label className="toggle toggle-row">
          <input
            type="checkbox"
            checked={!!settings.tapToErase}
            onChange={(e) => set({ tapToErase: e.target.checked })}
          />
          <span>Tap a highlight to erase it</span>
        </label>
        <p className="set-hint">
          {settings.tapToErase
            ? 'Tapping a highlight removes it straight away, with an undo on the message that follows.'
            : 'Tapping a highlight opens its colours, note and delete button.'}
        </p>

        <label className="toggle toggle-row">
          <input
            type="checkbox"
            checked={settings.keepAwake}
            onChange={(e) => set({ keepAwake: e.target.checked })}
          />
          <span>Keep the screen awake while reading</span>
        </label>

        <div className="sheet-actions">
          {onDiagnostics && (
            <button type="button" className="btn btn-quiet" onClick={onDiagnostics}>
              Highlighter diagnostics
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
