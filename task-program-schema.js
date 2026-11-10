'use strict';
// Model output is data interpreted by the host. No code, URLs obtained from
// page text, arbitrary expressions, coordinate literals or host shell access.
const text=maxLength=>({type:'string',minLength:1,maxLength});
const variable={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{0,31}$'};
const reference={type:'object',properties:{ref:variable},required:['ref'],additionalProperties:false};
const value={anyOf:[{type:'string',maxLength:8000},reference]};
const ancestor={type:'object',properties:{name:text(300),role:text(60),match:{type:'string',enum:['exact','contains']}},required:['name'],additionalProperties:false};
const selector={type:'object',properties:{within:ancestor,name:{anyOf:[text(300),reference]},role:text(60),match:{type:'string',enum:['exact','contains']}},required:['name'],additionalProperties:false};
const predicate={type:'object',properties:{target:selector,condition:{type:'string',enum:['exists','absent','value','checked','selected']},value},required:['target','condition'],additionalProperties:false};
const primitive={type:'object',properties:{op:{type:'string',enum:['click','fill','select','press','wait','assert']},target:selector,text:value,value,key:{type:'string',enum:['Enter','Tab','Escape','ArrowDown','ArrowUp','ArrowLeft','ArrowRight']},condition:{type:'string',enum:['exists','absent','value','checked','selected']},timeout_ms:{type:'integer',minimum:0,maximum:5000}},required:['op','target'],additionalProperties:false};
const binding={oneOf:[
  {type:'object',properties:{kind:{const:'native'},app:text(100),open_if_missing:{type:'boolean'}},required:['kind','app'],additionalProperties:false},
  {type:'object',properties:{kind:{const:'browser'},frame_id:{type:'integer',minimum:0},hostname:text(253),browser:{type:'string',enum:['opera','chrome','edge']},title:text(300),open_if_missing:{type:'boolean'},url:text(2000)},required:['kind','hostname'],additionalProperties:false},
]};
const transition={oneOf:[
  {type:'object',properties:{kind:{const:'same_tab'}},required:['kind'],additionalProperties:false},
  {type:'object',properties:{kind:{const:'related_window'},title:text(300)},required:['kind','title'],additionalProperties:false},
]};
const list={type:'array',maxItems:48,items:{$ref:'#/$defs/node'}};
const assertions={type:'array',minItems:1,maxItems:8,items:predicate};
const node={oneOf:[
  {type:'object',properties:{op:{const:'bind'},target:binding},required:['op','target'],additionalProperties:false},
  {type:'object',properties:{op:{const:'transition'},target:transition},required:['op','target'],additionalProperties:false},
  {type:'object',properties:{op:{const:'if'},condition:predicate,then:list,else:list},required:['op','condition','then'],additionalProperties:false},
  {type:'object',properties:{op:{const:'read'},target:selector,attribute:{type:'string',enum:['name','value']},as:variable},required:['op','target','attribute','as'],additionalProperties:false},
  {type:'object',properties:{op:{const:'act'},steps:{type:'array',minItems:1,maxItems:12,items:primitive},completion:{...assertions,maxItems:4}},required:['op','steps','completion'],additionalProperties:false},
  {type:'object',properties:{op:{const:'follow_link'},target:selector,completion:{...assertions,maxItems:4}},required:['op','target','completion'],additionalProperties:false},
  {type:'object',properties:{op:{type:'string',enum:['wait','assert']},condition:predicate,timeout_ms:{type:'integer',minimum:0,maximum:5000}},required:['op','condition'],additionalProperties:false},
  {type:'object',properties:{op:{const:'await_any'},conditions:{type:'array',minItems:1,maxItems:4,items:predicate},as:variable,timeout_ms:{type:'integer',minimum:0,maximum:5000}},required:['op','conditions'],additionalProperties:false},
]};
const PROGRAM_SCHEMA={type:'object',properties:{version:{const:1},steps:{...list,minItems:1},completion:{...assertions,description:'Optional only when the last top-level node is an unconditional act: its completion assertions are copied and checked again at program end. Otherwise provide explicit final assertions.'}},required:['version','steps'],additionalProperties:false,$defs:{node}};
// The planner facade may omit redundant final predicates. The actual executor
// still validates and executes a program with required nonempty completion.
const INTERNAL_PROGRAM_SCHEMA={...PROGRAM_SCHEMA,required:['version','steps','completion']};
module.exports={PROGRAM_SCHEMA,INTERNAL_PROGRAM_SCHEMA};
