'use strict';
// These typed fields are also validated by the shared local executor. No model
// code, expressions, CSS selectors or arbitrary shortcuts are executable.
const text=maxLength=>({type:'string',minLength:1,maxLength});
const ancestor={type:'object',properties:{name:text(300),role:text(60),match:{type:'string',enum:['exact','contains']}},required:['name'],additionalProperties:false};
const selector={type:'object',properties:{within:ancestor,name:text(300),role:text(60),match:{type:'string',enum:['exact','contains']}},required:['name'],additionalProperties:false};
const condition={type:'string',enum:['exists','absent','value','checked','selected']};
const assertion={type:'object',properties:{target:selector,condition,value:{type:'string',maxLength:8000}},required:['target','condition'],additionalProperties:false};
const step={type:'object',properties:{op:{type:'string',enum:['click','fill','select','press','wait','assert']},target:selector,text:{type:'string',maxLength:8000},value:{type:'string',maxLength:8000},key:{type:'string',enum:['Enter','Tab','Escape','ArrowDown','ArrowUp','ArrowLeft','ArrowRight']},condition,timeout_ms:{type:'integer',minimum:0,maximum:5000}},required:['op','target'],additionalProperties:false};
const planProperties={snapshot:text(80),steps:{type:'array',minItems:1,maxItems:12,items:step},completion:{type:'array',minItems:1,maxItems:4,items:assertion},final:{type:'boolean',description:'False for an intermediate phase; true only when this plan should finish all requested outcomes. Final phases receive independent completion review.'}};
module.exports={selector,planProperties};
