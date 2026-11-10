'use strict';

// Opt-in model benchmark on owned, hidden Electron fixtures. No desktop input,
// user pages, microphone or planner calls. Only a few account-authorized box-verifier calls.
const {app, BrowserWindow, nativeImage} = require('electron');
const fs = require('node:fs'), path = require('node:path');
const {AI} = require('../ai');
const {refineBox, refineTarget} = require('../visual-grounding');
const root = path.resolve(__dirname, '..'), directory = path.join(root, 'test-output');
app.disableHardwareAcceleration();
// Destroying our render-only window must not end pending model measurements.
app.on('window-all-closed', () => {});
const {connect}=require('./chatgpt-benchmark-host');
let host,window,passed=false;

const report = {
  status: 'running', at: new Date().toISOString(), version: require('../package.json').version,
  scope: 'A small paired target set and one absent-target diagnostic in owned hidden Electron screenshots. Real CPU GoClick proposals and account-selected GPT box verification. No user apps or desktop input. Existing-box baseline is supplied fixture bounds, so planner, speech, screenshot capture and task execution latency are excluded. Point-inside-target is not accurate centering or task-completion accuracy.',
  rows: [],
};
const save = () => {fs.mkdirSync(directory, {recursive: true}); fs.writeFileSync(path.join(directory, 'hybrid-grounding-benchmark.json'), JSON.stringify(report, null, 2));};
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null;
};
const inside = (point, box) => !!point && point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
const normalized = (box, width, height) => ({left: box.left / width, top: box.top / height, right: box.right / width, bottom: box.bottom / height});

async function fixtures() {
  window = new BrowserWindow({width: 760, height: 640, useContentSize: true, frame: false, show: false,
    webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true}});
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  await window.loadFile(path.join(root, 'tests', 'visual-fixture.html'));
  window.webContents.setZoomFactor(1);
  const geometry = await window.webContents.executeJavaScript('window.fixture.targets()');
  const shot = await window.webContents.capturePage();
  fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(directory, 'hybrid-grounding-canvas.png'), shot.toPNG());
  const image = shot.toDataURL();
  const cases = [
    {id: 'canvas_click', label: 'The colored rectangular Click once button', image, box: normalized(geometry.boxes.click, geometry.width, geometry.height)},
    {id: 'canvas_right_click', label: 'The colored rectangular Right click button', image, box: normalized(geometry.boxes.right_click, geometry.width, geometry.height)},
  ];
  window.setContentSize(900, 600);
  await window.loadFile(path.join(root, 'tests', 'grounding-fixture.html'));
  const circle = await window.webContents.executeJavaScript('({rect: window.targetRect(), width: innerWidth, height: innerHeight})');
  const circleShot = await window.webContents.capturePage();
  fs.writeFileSync(path.join(directory, 'hybrid-grounding-profile.png'), circleShot.toPNG());
  cases.push({id: 'profile_circle', label: 'The small circular Profile button, excluding the separate Profile text label', image: circleShot.toDataURL(),
    box: normalized({left: circle.rect.x, top: circle.rect.y, right: circle.rect.x + circle.rect.width, bottom: circle.rect.y + circle.rect.height}, circle.width, circle.height)});
  cases.push({id: 'absent_delete_account', label: 'The Delete account button', image, absent: true});
  window.destroy(); window = null;
  return cases;
}

async function trial(ai, fixture, mode) {
  const started = performance.now(), row = {target: fixture.id, mode, expectedAbsent: !!fixture.absent, expectedBox: fixture.box || null, localCropUsed: false, localMs: 0, cloudMs: 0, cloudCalls: 0};
  const signal = AbortSignal.timeout(18000);
  const propose = async (image, label, innerSignal) => {
    const localStart = performance.now();
    try {
      const result = await ai.proposeTarget(image, label, innerSignal);
      row.localCropUsed = !!result?.point;
      row.localPoint = result?.point || null;
      if (fixture.box) row.localPointHit = inside(result?.point, fixture.box);
      return result;
    } finally {row.localMs += performance.now() - localStart;}
  };
  const locate = async (image, label, innerSignal) => {
    const cloudStart = performance.now(); row.cloudCalls++;
    try {return await ai.locate(image, label, innerSignal);}
    finally {row.cloudMs += performance.now() - cloudStart;}
  };
  try {
    const args = {nativeImage, image: fixture.image, label: fixture.label, locate, signal};
    const box = mode === 'existing_box' ? await refineBox({...args, box: fixture.box}) : await refineTarget({...args, propose});
    const center = {x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2};
    row.box = box;
    row.hit = !fixture.absent && inside(center, fixture.box);
    row.refused = false;
    if (fixture.box) {
      const size = nativeImage.createFromDataURL(fixture.image).getSize();
      row.centerErrorPixels = {x: (center.x - (fixture.box.left + fixture.box.right) / 2) * size.width,
        y: (center.y - (fixture.box.top + fixture.box.bottom) / 2) * size.height};
    }
  } catch (error) {
    row.hit = false; row.refused = true;
    row.reason = signal.aborted ? 'timeout' : /could not be identified|No input was sent|close-up/i.test(error.message || '') ? 'target_unverified' : 'model_or_runtime_error';
  }
  row.totalMs = Math.round(performance.now() - started);
  row.localMs = Math.round(row.localMs); row.cloudMs = Math.round(row.cloudMs);
  report.rows.push(row); save();
  console.log(JSON.stringify({target: row.target, mode: row.mode, totalMs: row.totalMs, localCropUsed: row.localCropUsed, hit: row.hit, refused: row.refused, reason: row.reason}));
}

app.whenReady().then(async () => {
  console.log(JSON.stringify({phase: 'ready'}));
  host=await connect();
  const settings={...host.settings,allowScreen:true,localGrounding:true};
  const ai=new AI(()=>settings,async()=>'',async()=>{throw Error('No desktop tools in this benchmark');},fetch,host.provider);
  report.runtime = await ai.groundingStatus();
  if (!report.runtime.ready) throw Object.assign(Error(), {code: 'local_grounder_not_ready'});
  console.log(JSON.stringify({phase: 'runtime_ready', device: report.runtime.device}));
  let cases = await fixtures();
  if (process.argv.includes('--two-targets')) cases = cases.filter(fixture => fixture.id !== 'profile_circle');
  report.targetCount = cases.filter(fixture => !fixture.absent).length;
  for (const [index, fixture] of cases.entries()) {
    const modes = fixture.absent ? ['hybrid_label'] : index % 2 ? ['hybrid_label', 'existing_box'] : ['existing_box', 'hybrid_label'];
    for (const mode of modes) await trial(ai, fixture, mode);
  }
  report.summary = {};
  for (const mode of ['existing_box', 'hybrid_label']) {
    const rows = report.rows.filter(row => row.mode === mode && !row.expectedAbsent), successful = rows.filter(row => row.hit);
    report.summary[mode] = {targets: rows.length, hits: successful.length, refused: rows.filter(row => row.refused).length,
      medianMs: median(rows.map(row => row.totalMs)), verifiedHitMedianMs: median(successful.map(row => row.totalMs)), localCropsUsed: rows.filter(row => row.localCropUsed).length};
  }
  report.summary.absentTargetRefused = report.rows.find(row => row.expectedAbsent)?.refused === true;
  report.summary.cloudCalls = report.rows.reduce((sum, row) => sum + row.cloudCalls, 0);
  report.status = 'completed'; passed = true; save();
  console.log(JSON.stringify({status: report.status, summary: report.summary}));
}).catch(error => {
  report.status = 'failed';
  report.errorCode = ['encrypted_metadata_missing', 'encrypted_key_missing', 'local_grounder_not_ready'].includes(error.code) ? error.code : 'benchmark_failed';
  save(); console.error(JSON.stringify({status: report.status, errorCode: report.errorCode}));
}).finally(() => {
  host?.close();
  if (window && !window.isDestroyed()) window.destroy();
  save(); app.exit(passed ? 0 : 1);
});
