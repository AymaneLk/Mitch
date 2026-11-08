const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {ActivityOverlay} = require('../activity-overlay');

class FakeWindow extends EventEmitter {
  constructor(options) { super();this.options=options;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.visible=false;this.dead=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=fn=>{this.openHandler=fn;}; }
  setIgnoreMouseEvents(value) {this.clickThrough=value;}
  setAlwaysOnTop(value,level) {this.onTop=value;this.level=level;}
  setContentProtection(value) {this.protected=value;}
  setBounds(value) {this.bounds=value;}
  isDestroyed() {return this.dead;}
  loadFile(file) {this.file=file;return Promise.resolve();}
  showInactive() {this.visible=true;this.inactiveShows=(this.inactiveShows||0)+1;}
  hide() {this.visible=false;}
  destroy() {this.dead=true;this.visible=false;this.emit('closed');}
}
function fixture() {
  const screen=new EventEmitter();screen.displays=[{id:1,bounds:{x:0,y:0,width:1920,height:1080}},{id:2,bounds:{x:-1280,y:0,width:1280,height:1024}}];screen.getAllDisplays=()=>screen.displays;
  return {screen,overlay:new ActivityOverlay({BrowserWindow:FakeWindow,screen,root:'C:/Pixie'})};
}

test('corners cover every display without mouse interception, focus or an idle visible window',async()=>{
  const {overlay}=fixture();assert.equal(overlay.windows.size,2);
  for(const win of overlay.windows.values()) {
    assert.equal(win.visible,false);assert.equal(win.options.focusable,false);assert.equal(win.options.transparent,true);assert.equal(win.clickThrough,true);assert.equal(win.protected,true);assert.equal(win.options.skipTaskbar,true);assert.deepEqual(win.openHandler(),{action:'deny'});assert.equal(win.options.webPreferences.sandbox,true);win.emit('ready-to-show');
  }
  await overlay.show();for(const win of overlay.windows.values())assert.equal(win.visible,true);
  overlay.hide();for(const win of overlay.windows.values())assert.equal(win.visible,false);overlay.destroy();
});

test('Stop during a late page load never makes the indicator reappear',async()=>{
  const {overlay}=fixture();const showing=overlay.show();overlay.hide();for(const win of overlay.windows.values())win.emit('ready-to-show');await showing;
  assert.equal(overlay.active,false);for(const win of overlay.windows.values())assert.equal(win.visible,false);overlay.destroy();
});

test('display changes preserve visibility, update coordinates and clean removed windows',async()=>{
  const {screen,overlay}=fixture();for(const win of overlay.windows.values())win.emit('ready-to-show');await overlay.show();
  const removed=overlay.windows.get('2');screen.displays=[{id:1,bounds:{x:0,y:0,width:2560,height:1440}},{id:3,bounds:{x:2560,y:-100,width:1920,height:1080}}];screen.emit('display-metrics-changed');
  assert.equal(removed.dead,true);assert.equal(overlay.windows.has('2'),false);assert.equal(overlay.windows.get('1').bounds.width,2560);
  const added=overlay.windows.get('3');assert.equal(added.visible,false);added.emit('ready-to-show');assert.equal(added.visible,true);
  overlay.destroy();assert.equal(screen.listenerCount('display-added'),0);assert.equal(screen.listenerCount('display-removed'),0);assert.equal(screen.listenerCount('display-metrics-changed'),0);assert.equal(added.dead,true);
});

test('destroy resolves in-flight readiness and remains idempotent',async()=>{
  const {overlay}=fixture();const showing=overlay.show();overlay.destroy();await showing;overlay.destroy();await overlay.show();assert.equal(overlay.windows.size,0);assert.equal(overlay.active,false);
});

test('renderer failure prevents an action from proceeding with an absent indicator',async()=>{
  const {overlay}=fixture();const showing=overlay.show();
  const windows=[...overlay.windows.values()];windows[0].webContents.emit('did-fail-load',{},-6,'Missing file');windows[1].emit('ready-to-show');
  await assert.rejects(showing,/indicator could not load/);assert.equal(overlay.active,false);for(const win of windows)assert.equal(win.visible,false);overlay.destroy();
});
