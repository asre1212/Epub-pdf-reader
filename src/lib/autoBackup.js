/* Local recovery only. Named payloads are stored in a separate IndexedDB store. */
function makeAutoBackup({id, extension = '.json', scope, capture, restore, validate}) {
  const db = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(id + '-auto-backup-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('backup');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function access(write, fn) {
    const database = await db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = database.transaction('backup', write ? 'readwrite' : 'readonly');
        const store = tx.objectStore('backup');
        const request = store.get('state');
        let result;
        const error = () => reject(tx.error || request.error || Error('Auto backup storage failed'));
        request.onsuccess = () => {
          try {
            const state = request.result || {enabled:false, copies:[]};
            result = fn(state);
            if (write) store.put(state,'state');
          } catch (e) { reject(e); tx.abort(); }
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = error;
        tx.onabort = error;
      });
    } finally { database.close(); }
  }
  let queue = Promise.resolve();
  let paused = false;
  let failure = '';
  const serial = (fn) => {
    const done = queue.then(fn, fn);
    queue = done.catch(() => {});
    return done;
  };
  function record(pending = capture) {
    if (paused) return Promise.resolve();
    return serial(async () => {
      if (!(await access(false, s => s.enabled))) return;
      const content = await (typeof pending === 'function' ? pending() : pending);
      if (typeof content !== 'string' || !content) return;
      await access(true, s => {
        if (!s.enabled || s.copies[0]?.content === content) return;
        s.copies = [{at: new Date().toISOString(), content}, ...s.copies].slice(0, 2);
      });
      failure = '';
    }).catch(() => { failure = 'Could not save a recovery copy. The previous copies were kept.'; });
  }
  function share(copy) {
    const name = id + '-backup-' + copy.at.replaceAll(':', '-') + extension;
    const file = new File([copy.content], name, {type:'application/json'});
    if (navigator.canShare?.({files:[file]})) {
      return navigator.share({files:[file]}).catch(error => {
        if (error.name !== 'AbortError') throw error;
      });
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  async function open() {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Auto Backup');
    dialog.style.cssText = 'max-width:min(32rem,90vw);max-height:85vh;padding:1.2rem;border:1px solid #888;border-radius:12px;color:inherit;background:Canvas';
    const append = (tag, text) => {
      const item = document.createElement(tag);
      item.textContent = text;
      dialog.append(item);
      return item;
    };
    const button = (text, handler) => {
      const item = append('button', text);
      item.type = 'button';
      item.style.margin = '.3rem .5rem .3rem 0';
      item.onclick = () => {
        try {
          const operation = handler();
          operation?.catch(() => alert('Auto Backup could not finish that action.'));
        } catch { alert('Auto Backup could not finish that action.'); }
      };
      return item;
    };
    const refresh = async () => {
      const s = await access(false, x => x);
      dialog.replaceChildren();
      append('h2','Auto Backup');
      append('p',scope);
      append('p','Keeps the two latest distinct saved versions on this device. Clearing app or browser storage removes these copies. Use Save to Files to keep a separate copy.');
      if (failure) append('p',failure).role = 'status';
      button(s.enabled ? 'Turn off Auto Backup' : 'Turn on Auto Backup', async () => {
        await serial(() => access(true, state => { state.enabled = !s.enabled; }));
        if (!s.enabled) await record();
        await refresh();
      });
      if (!s.copies.length) append('p','No recovery copies yet.');
      const recover = async (content) => {
        const value = await validate(content);
        if (!confirm('Restore this recovery copy? This may replace current data.')) return;
        paused = true;
        try { await restore(value); } finally { paused = false; }
        await record();
        if (dialog.isConnected) { await refresh(); alert('Recovery copy restored.'); }
      };
      s.copies.forEach((copy, i) => {
        append('h3',(i === 0 ? 'Latest' : 'Previous') + ' · ' + new Date(copy.at).toLocaleString());
        button('Save to Files', () => share(copy));
        button('Restore this copy', () => recover(copy.content));
      });
      const input = append('input','');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.hidden = true;
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try { await recover(await file.text()); }
        catch { alert('This file could not be restored. Your current data was not changed.'); }
        finally { input.value = ''; }
      };
      button('Restore from Files', () => input.click());
      button('Close',() => dialog.close());
    };
    await refresh();
    dialog.addEventListener('close',() => dialog.remove(), {once:true});
    document.body.append(dialog);
    dialog.showModal();
  }
  return {record,open,access,serial};
}

export { makeAutoBackup };
