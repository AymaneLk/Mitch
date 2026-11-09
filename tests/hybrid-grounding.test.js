'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {refineTarget} = require('../visual-grounding');

function fixture(width = 1200, height = 800) {
  const crops = [];
  const nativeImage = {createFromDataURL: image => {
    assert.equal(image, 'original-image');
    return {
      getSize: () => ({width, height}),
      crop: region => {
        crops.push(region);
        return {toDataURL: () => 'cropped-image'};
      },
    };
  }};
  return {nativeImage, image: 'original-image', label: 'Profile button', crops, width, height};
}

const candidate = point => ({found: true, point, box: null, grounding_only: true});
const verified = {left: .3, top: .25, right: .7, bottom: .75};

test('a local point proposes a crop; only verified element bounds determine the result', async () => {
  const f = fixture();
  const calls = [];
  const box = await refineTarget({...f,
    propose: async (image, label) => {calls.push('proposal'); assert.equal(image, f.image); assert.equal(label, f.label); return candidate({x: .75, y: .5});},
    locate: async (image, label) => {calls.push('verification'); assert.equal(image, 'cropped-image'); assert.equal(label, f.label); return {found: true, box: verified};},
  });
  assert.deepEqual(calls, ['proposal', 'verification']);
  assert.equal(f.crops.length, 1);
  const crop = f.crops[0];
  assert.equal(crop.width, 512);
  assert.equal(crop.height, 512);
  assert.deepEqual(box, {
    left: (crop.x + .3 * 512) / 1200,
    top: (crop.y + .25 * 512) / 800,
    right: (crop.x + .7 * 512) / 1200,
    bottom: (crop.y + .75 * 512) / 800,
  });
  assert.ok(box.right > box.left && box.bottom > box.top);
});

test('proposal crops stay inside the screenshot near every screen edge', async () => {
  for (const point of [{x: 0, y: 0}, {x: 1, y: 0}, {x: 0, y: 1}, {x: 1, y: 1}]) {
    const f = fixture(900, 600);
    const edgeBox = {left: point.x ? .9 : 0, top: point.y ? .9 : 0, right: point.x ? 1 : .1, bottom: point.y ? 1 : .1};
    const box = await refineTarget({...f, propose: async () => candidate(point), locate: async () => ({found: true, box: edgeBox})});
    const crop = f.crops[0];
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.width <= f.width && crop.y + crop.height <= f.height);
    assert.ok(Object.values(box).every(value => value >= 0 && value <= 1));
  }
});

test('a verifier box that contradicts the local point is refused instead of becoming a click', async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(refineTarget({...f,
    propose: async () => candidate({x: .5, y: .5}),
    locate: async () => {calls++; return {found: true, box: {left: .1, top: .1, right: .3, bottom: .3}};},
  }));
  assert.equal(calls, 1, 'Contradictory grounding must not cause another model guess');
});

test('recorded Click once crop mismatch is refused even though the cloud returned found true', async () => {
  const f = fixture(760, 640);
  await assert.rejects(refineTarget({...f, label: 'The colored rectangular Click once button',
    propose: async () => candidate({x: .1645, y: .2145}),
    // Real fixture result: mapped box ended at y=.2056, above the correct
    // proposal y=.2145. Clicking its center would miss the button by 35px.
    locate: async () => ({found: true, box: {left: .093, top: .143, right: .394, bottom: .257}}),
  }));
});

test('small screenshots are never enlarged beyond their original dimensions', async () => {
  const f = fixture(320, 200);
  await refineTarget({...f, propose: async () => candidate({x: .5, y: .5}), locate: async () => ({found: true, box: verified})});
  assert.deepEqual(f.crops, [{x: 0, y: 0, width: 320, height: 200}]);
});

test('unavailable or malformed local proposals use full-frame verification without manufacturing a box', async () => {
  const proposals = [
    async () => {throw new Error('Local model is offline');},
    async () => null,
    async () => ({found: false, point: null}),
    async () => candidate({x: -1, y: .5}),
    async () => candidate({x: .5, y: 1.01}),
    async () => candidate({x: NaN, y: .5}),
    async () => candidate({x: '.5', y: .5}),
  ];
  for (const propose of proposals) {
    const f = fixture();
    let verifiedCalls = 0;
    const box = await refineTarget({...f, propose, locate: async image => {verifiedCalls++; assert.equal(image, 'cropped-image'); assert.deepEqual(f.crops.at(-1), {x: 0, y: 0, width: f.width, height: f.height}); return {found: true, box: verified};}});
    assert.equal(verifiedCalls, 1);
    assert.equal(f.crops.length, 1);
    assert.deepEqual(box, verified);
  }
});

test('local coordinate validity never substitutes for missing or ambiguous target verification', async () => {
  for (const reply of [{found: false, box: null}, {found: true, box: null}, {found: true, box: {left: .7, top: .1, right: .2, bottom: .3}}]) {
    const f = fixture();
    let checks = 0;
    await assert.rejects(refineTarget({...f, propose: async () => candidate({x: .5, y: .5}), locate: async () => {checks++; return reply;}}));
    assert.equal(checks, 1, 'A rejected target must not trigger another guess or alternate verifier call');
  }
});

test('verified targets clipped by a proposal crop are refused instead of clicking a partial box center', async () => {
  for (const box of [{...verified, left: 0}, {...verified, top: 0}, {...verified, right: 1}, {...verified, bottom: 1}]) {
    const f = fixture();
    let checks = 0;
    await assert.rejects(refineTarget({...f, propose: async () => candidate({x: .5, y: .5}), locate: async () => {checks++; return {found: true, box};}}));
    assert.equal(checks, 1);
  }
});

test('cancellation during local inference cannot invoke a verifier or use a late point', async () => {
  const f = fixture(), controller = new AbortController();
  let checks = 0;
  await assert.rejects(refineTarget({...f, signal: controller.signal,
    propose: async () => {controller.abort(new Error('Task stopped')); return candidate({x: .5, y: .5});},
    locate: async () => {checks++; return {found: true, box: verified};},
  }), /Task stopped/);
  assert.equal(checks, 0);
});

test('cancellation while a local request fails cannot fall through to cloud verification', async () => {
  const f = fixture(), controller = new AbortController();
  await assert.rejects(refineTarget({...f, signal: controller.signal,
    propose: async () => {controller.abort(new Error('Task stopped')); throw new Error('Request aborted');},
    locate: async () => assert.fail('Cancelled local requests must not fall through'),
  }), /Task stopped/);
});

test('cancellation during verification rejects its late bounding box', async () => {
  const f = fixture(), controller = new AbortController();
  await assert.rejects(refineTarget({...f, signal: controller.signal,
    propose: async () => candidate({x: .5, y: .5}),
    locate: async () => {controller.abort(new Error('Task stopped')); return {found: true, box: verified};},
  }), /Task stopped/);
});

test('existing planner boxes retain their established refinement route without local inference', async () => {
  const f = fixture();
  const box = await refineTarget({...f, box: {left: .1, top: .2, right: .2, bottom: .3},
    propose: async () => assert.fail('Legacy boxes must not incur an extra local inference'),
    locate: async image => {assert.equal(image, 'cropped-image'); return {found: true, box: verified};},
  });
  assert.equal(f.crops.length, 1);
  assert.ok(box.left < box.right && box.top < box.bottom);
});

test('missing labels and an already cancelled task cannot send images to either model', async () => {
  const f = fixture(), controller = new AbortController();
  const never = async () => assert.fail('No model calls should be made');
  await assert.rejects(refineTarget({...f, label: '', propose: never, locate: never}));
  controller.abort(new Error('Task stopped'));
  await assert.rejects(refineTarget({...f, signal: controller.signal, propose: never, locate: never}), /Task stopped/);
});
