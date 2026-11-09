'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {changedFraction,compareImages}=require('../visual-change');
test('visual change measurement ignores small color noise and counts changed pixels',()=>{
  const before=Buffer.alloc(400,100),noise=Buffer.alloc(400,120),after=Buffer.alloc(400,100);
  after.fill(0,0,40);
  assert.equal(changedFraction(before,noise),0);assert.equal(changedFraction(before,after),.1);
  assert.equal(changedFraction(before,Buffer.alloc(0)),null);
  assert.deepEqual(compareImages(null,'same','same'),{meaningful:false,changed_fraction:0});
});
