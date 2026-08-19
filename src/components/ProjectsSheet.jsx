import { useMemo, useState } from 'react';

/**
 * Managing the folders themselves, away from the notes in them.
 *
 * Deleting a project here never deletes a highlight — the count beside each name
 * says how many would come loose, so the choice is made with that in front of
 * the reader rather than discovered afterwards.
 */
export default function ProjectsSheet({
  projects,
  highlights,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onClose,
}) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  const counts = useMemo(() => {
    const map = new Map();
    for (const highlight of highlights) {
      if (!highlight.projectId) continue;
      map.set(highlight.projectId, (map.get(highlight.projectId) || 0) + 1);
    }
    return map;
  }, [highlights]);

  const startRename = (project) => {
    setConfirmId(null);
    setEditingId(project.id);
    setDraft(project.name);
  };

  const commitRename = async (project) => {
    const name = draft.trim();
    setEditingId(null);
    if (name && name !== project.name) await onRename(project.id, name);
  };

  const move = (index, delta) => {
    const next = [...projects];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next.map((project) => project.id));
  };

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Projects"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <h2 className="sheet-title">Projects</h2>
        <p className="set-hint">
          Folders that cut across books. A highlight sits in one project, or in none — file it from
          the picker on any note, or file a whole filtered list at once from the notepad.
        </p>

        {!projects.length && (
          <p className="diag-empty">
            No projects yet. Make one, then file highlights into it from any note.
          </p>
        )}

        <ul className="project-list">
          {projects.map((project, index) => {
            const count = counts.get(project.id) || 0;
            return (
              <li key={project.id} className="project-row">
                {editingId === project.id ? (
                  <input
                    className="field"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitRename(project)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(project);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    aria-label={`Rename ${project.name}`}
                  />
                ) : (
                  <button
                    type="button"
                    className="project-name"
                    onClick={() => startRename(project)}
                    title="Rename"
                  >
                    <strong>{project.name}</strong>
                    <span className="muted small">
                      {count} highlight{count === 1 ? '' : 's'}
                    </span>
                  </button>
                )}

                <div className="project-row-actions">
                  <button
                    type="button"
                    className="icon-btn-bare"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${project.name} up`}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn-bare"
                    onClick={() => move(index, 1)}
                    disabled={index === projects.length - 1}
                    aria-label={`Move ${project.name} down`}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => setConfirmId(confirmId === project.id ? null : project.id)}
                  >
                    Delete
                  </button>
                </div>

                {confirmId === project.id && (
                  <p className="project-confirm">
                    Delete <strong>{project.name}</strong>?{' '}
                    {count > 0
                      ? `Its ${count} highlight${count === 1 ? '' : 's'} stay, unfiled.`
                      : 'It holds nothing.'}
                    <button
                      type="button"
                      className="btn btn-small danger-btn"
                      onClick={async () => {
                        setConfirmId(null);
                        await onDelete(project.id);
                      }}
                    >
                      Delete project
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-ghost"
                      onClick={() => setConfirmId(null)}
                    >
                      Keep
                    </button>
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className="sheet-actions">
          <button type="button" className="btn btn-quiet" onClick={() => onCreate()}>
            New project
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
