/* External backups only. The database retains folder metadata and any older recovery copies. */
function makeAutoBackup({id, extension = '.json', scope, capture, restore, validate}) {
  const db = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(id + '-auto-backup-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('backup');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function access(write, fn, key = 'state') {
    const database = await db();
    try {
      return await new Promise((resolve, reject) => {
        const tx = database.transaction('backup', write ? 'readwrite' : 'readonly');
        const store = tx.objectStore('backup');
        const request = store.get(key);
        let result;
        const error = () => reject(tx.error || request.error || Error('Auto backup storage failed'));
        request.onsuccess = () => {
          try {
            const state = request.result || (key === 'state' ? {enabled:false, copies:[]} : {});
            result = fn(state);
            if (write) store.put(state,key);
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
  const canChooseFolder = () => typeof window.showDirectoryPicker === 'function' &&
    typeof navigator.locks?.request === 'function' && !!crypto.subtle;
  const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2,'0')).join('');
  const hasPermission = async folder => typeof folder?.queryPermission === 'function' &&
    await folder.queryPermission({mode:'readwrite'}) === 'granted';
  function record(pending = capture) {
    if (paused || !canChooseFolder()) return Promise.resolve();
    return serial(() => navigator.locks.request(id + '-files-backup', async () => {
      const ext = await access(false, s => s.external, 'folder');
      if (!ext?.enabled || !ext.folder || !await hasPermission(ext.folder)) return;
      const saved = await (typeof pending === 'function' ? pending() : pending);
      const content = typeof saved === 'string' ? saved : saved?.content;
      if (!content) return;
      const hashValue = await hash(content);
      const digest = saved?.digest || hashValue;
      if (ext.recent[0]?.digest === digest) return;
      const at = new Date().toISOString();
      const name = id + '-auto-backup-' + at.replaceAll(':','-') + '-' + crypto.randomUUID() + extension;
      const file = await ext.folder.getFileHandle(name, {create:true});
      const writable = await file.createWritable();
      try { await writable.write(content); await writable.close(); }
      catch (error) { await writable.abort?.().catch(() => {}); throw error; }
      if (await (await file.getFile()).text() !== content) throw Error('Unable to verify backup file');
      const copies = [{name, at, digest, hashValue}, ...ext.recent];
      await access(true, s => { s.external.recent = copies; }, 'folder');
      const unpruned = [];
      for (const old of copies.slice(2)) {
        try {
          const oldFile = await ext.folder.getFileHandle(old.name);
          if (await hash(await (await oldFile.getFile()).text()) === old.hashValue) {
            await ext.folder.removeEntry(old.name);
          }
        } catch (error) {
          if (error?.name !== 'NotFoundError') unpruned.push(old);
        }
      }
      await access(true, s => { s.external.recent = [...copies.slice(0, 2), ...unpruned]; }, 'folder');
      failure = unpruned.length ? 'The latest backup was saved, but some older copies could not be removed.' : '';
    })).catch(() => { failure = 'Could not save or verify the folder backup. Previous copies were kept.'; });
  }
  async function chooseFolder() {
    const folder = await window.showDirectoryPicker({mode:'readwrite'});
    if (!await hasPermission(folder)) throw Error('Folder permission was not granted');
    await serial(() => navigator.locks.request(id + '-files-backup', async () => {
      const prev = await access(false, s => s.external, 'folder');
      const same = prev?.folder && await folder.isSameEntry?.(prev.folder);
      await access(true, s => {
        s.external = {enabled:true, folder, recent:same ? prev.recent : []};
      }, 'folder');
    }));
    await record();
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
      const [s, external] = await Promise.all([access(false, x => x), access(false, x => x.external, 'folder')]);
      const preparedManual = await capture();
      dialog.replaceChildren();
      append('h2','Auto Backup');
      append('p',scope);
      append('p','Automatic backup only writes to a folder you choose, and never saves copies in the app.');
      if (!canChooseFolder()) {
        append('p','This browser does not support automatic writes to a Files folder. Use the manual Files options below.');
      } else {
        const permitted = external?.enabled && await hasPermission(external.folder).catch(() => false);
        if (external?.enabled) append('p', permitted ? 'Folder: ' + external.folder.name : 'Folder access needs to be granted again.');
        button(permitted ? 'Change backup folder' : 'Choose backup folder', async () => {
          try { await chooseFolder(); }
          catch (error) { if (error?.name !== 'AbortError') throw error; }
          await refresh();
        });
        if (external?.enabled) button('Turn off Auto Backup', async () => {
          await serial(() => navigator.locks.request(id + '-files-backup', () => access(true, state => {
            if (state.external) state.external.enabled = false;
          }, 'folder')));
          await refresh();
        });
      }
      if (failure) append('p',failure).role = 'status';
      button('Save current copy to Files', async () => {
        const saved = preparedManual;
        const content = typeof saved === 'string' ? saved : saved?.content;
        if (!content) throw Error('No backup ready');
        await share({at:new Date().toISOString(),content});
      });
      if (s.copies.length) append('p','Older recovery copies (no new copies are stored in the app):');
      const recover = async (content) => {
        const value = await validate(content);
        if (!confirm('Restore this recovery copy? This may replace current data.')) return;
        paused = true;
        try { await restore(value); } finally { paused = false; }
        await record();
        if (dialog.isConnected) { await refresh(); alert('Recovery copy restored.'); }
      };
      s.copies.forEach((copy, i) => {
        append('h3',(i === 0 ? 'Latest older copy' : 'Previous older copy') + ' · ' + new Date(copy.at).toLocaleString());
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
