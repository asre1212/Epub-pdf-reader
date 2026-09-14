import React from 'react';
import { createRoot } from 'react-dom/client';
import GrowingField from '../src/components/GrowingField.jsx';
import Cover from '../src/components/Cover.jsx';
const root = createRoot(document.getElementById('root'));
window.showDraft = (value = '') => root.render(<GrowingField key="test" draftKey="test" value={value} ariaLabel="Test draft" onCommit={async text => { if (window.failSave) throw new Error('Save failed'); window.savedText = text; }} />);
window.showCover = () => root.render(<Cover book={{ title: 'Fallback title', format: 'epub', cover: new Blob(['bad'], { type: 'image/png' }) }} />);
window.harnessReady = true;
