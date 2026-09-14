# Library reliability fixes

These changes address the feature audit in its requested priority order.

| Area | Result |
| --- | --- |
| Backup | Full exports include every book, project and written summary, including books with no highlights. |
| Restore | Validate first; commit all records in one transaction. Never match conflicting fingerprints by title or ID. Clear deletion markers and stamp restored work as new. |
| Sync | Accept positions, highlights, projects and summaries. Batch uploads, drain downloads, use composite cursors and atomic D1 writes. Retry failed applications without advancing the saved cursor. |
| Conflicts | Compare local timestamps and deletion markers in the same IndexedDB transaction as applying remote changes. |
| Drafts | Retain unsaved text across navigation/reload; show save errors with retry. Remote updates do not replace dirty drafts. Escape cancels without committing. |
| Updates | Defer automatic updates while reading, editing notes, importing, or holding retained drafts. |
| Covers | Validate/decode images; inspect EPUB 2/3 declarations and early content documents; skip nearly blank PDF opening pages. Repair existing covers or choose a replacement image from the library menu. |
| Study sheets | Retain chapters and books with summaries even after their last highlight is removed. |
| Reader | Allow the highlights drawer without a contents list; report storage-read errors; release late wake locks. |
| Imports | Save book bytes and metadata atomically; serialize batches; acknowledge shared files only after successful import. |
| Exports | Include cues in plain exports and provide complete Cornell/outline exports. Recover from Clipboard API rejection and report print failures. |
| Storage | Request persistent storage when supported, report settings-save failures, and validate restored settings. |
| Offline | Precache PDF CMaps and decoder fallbacks along with existing fonts/decoders. |

## Deployment

Deploy the updated sync worker **before** the frontend. No database migration is
required. Existing v1 clients remain supported. Updated clients use /v2/sync and
replay their first pull so earlier scalar-cursor gaps can recover from server data.

Deleting the server copy disconnects the initiating device. Disconnect other
devices separately to prevent them uploading local changes again.

## Verification

CI runs the existing page-turn tests, backup and sync regressions using real
SQLite, a production build, and browser checks in Chromium and WebKit at an
iPhone-sized viewport. Browser checks use real IndexedDB for backup/restore,
rollback, deletion handling and imports, and exercise draft recovery and cover
fallbacks.

Headless WebKit does not replace a physical iPhone. Before deployment, repeat the
touch, rotation, zoom and Home Screen PWA checks in tests/README.md using an actual
device and the specific book whose cover failed. Book files remain local and are
not included in notes backups or sync.
