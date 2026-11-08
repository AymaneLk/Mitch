const path = require('node:path');

/** A display-only overlay, separate from screen annotations and screenshots. */
class ActivityOverlay {
  constructor({BrowserWindow, screen, root = __dirname}) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.root = root;
    this.windows = new Map();
    this.entries = new Map();
    this.active = false;
    this.destroyed = false;
    this.generation = 0;
    this.refresh = () => this.syncDisplays();
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, this.refresh);
    this.syncDisplays();
  }

  syncDisplays() {
    if (this.destroyed) return;
    const displays = this.screen.getAllDisplays();
    const ids = new Set(displays.map(display => String(display.id)));
    for (const [id, entry] of this.entries) {
      if (!ids.has(id)) {
        this.entries.delete(id);
        this.windows.delete(id);
        if (!entry.window.isDestroyed()) entry.window.destroy();
      }
    }
    for (const display of displays) {
      const id = String(display.id);
      let entry = this.entries.get(id);
      if (entry && !entry.window.isDestroyed()) {
        entry.window.setBounds({...display.bounds});
      } else {
        entry = this.createWindow(display);
        this.entries.set(id, entry);
        this.windows.set(id, entry.window);
      }
      if (this.active && entry.loaded && !entry.window.isDestroyed()) entry.window.showInactive();
    }
  }

  createWindow(display) {
    const win = new this.BrowserWindow({
      ...display.bounds,
      title: 'Pixie computer use',
      transparent: true, backgroundColor: '#00000000',
      frame: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, alwaysOnTop: true, skipTaskbar: true,
      hasShadow: false, show: false, enableLargerThanScreen: true,
      webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false},
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    win.webContents.on('will-navigate', event => event.preventDefault());
    const entry = {window: win, loaded: false, ready: null, error: null};
    // A late load must never redisplay a stopped or destroyed overlay.
    entry.ready = new Promise(resolve => {
      const done = () => {win.removeListener('ready-to-show', loaded); resolve();};
      const loaded = () => {
        entry.loaded = true;
        if (this.active && !this.destroyed && !win.isDestroyed()) win.showInactive();
        done();
      };
      win.once('ready-to-show', loaded);
      win.once('closed', done);
      win.webContents.once('did-fail-load', (_event, code, description) => {
        entry.error = new Error(`Computer-use indicator could not load (${code}): ${description || 'renderer load failed'}`);
        done();
      });
    });
    // Keep creation errors visible to the host while avoiding an unhandled rejection.
    win.loadFile(path.join(this.root, 'ui', 'activity.html')).catch(error => {
      entry.error = new Error(`Computer-use indicator could not load: ${error.message}`);
      if (!win.isDestroyed()) win.destroy();
    });
    return entry;
  }

  async ready() {
    const entries = [...this.entries.values()];
    await Promise.all(entries.map(entry => entry.ready));
    for (const entry of entries) {
      if (![...this.entries.values()].includes(entry)) continue;
      if (entry.error) throw entry.error;
      if (entry.window.isDestroyed()) throw new Error('Computer-use indicator closed before it was ready.');
    }
  }

  async show() {
    if (this.destroyed) return;
    const generation = this.generation;
    this.active = true;
    this.syncDisplays();
    try { await this.ready(); }
    catch (error) { if (generation === this.generation) this.hide(); throw error; }
  }

  hide() {
    this.generation++;
    this.active = false;
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.hide();
  }

  destroy() {
    if (this.destroyed) return;
    this.active = false;
    this.destroyed = true;
    this.generation++;
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) this.screen.removeListener(event, this.refresh);
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
    this.entries.clear();
  }
}

module.exports = {ActivityOverlay};
