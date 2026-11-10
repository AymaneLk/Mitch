// Pinned-provider instrumentation: distinguish rejected writes from lost results.
// Per-call async context prevents concurrent MCP requests sharing write receipts.
import {AsyncLocalStorage} from 'node:async_hooks';
const execution=new AsyncLocalStorage();
const rejectedStatuses=new Set([400,401,403,404,405,409,422,429]);
export async function trackedFetch(url,options={}){
 const state=execution.getStore();const mutation=!['GET','HEAD','OPTIONS'].includes((options.method||'GET').toUpperCase());
 const write=state&&mutation?{outcome:'unknown'}:null;if(write)state.writes.push(write);
 const response=await fetch(url,options);
 if(write)write.outcome=response.ok?'accepted':rejectedStatuses.has(response.status)?'rejected':'unknown';
 return response;
}
export async function runWithOutcome(fn){
 return execution.run({writes:[]},async()=>{
  try{return {content:[{type:'text',text:await fn()}]};}
  catch(error){
   const writes=execution.getStore().writes,accepted=writes.filter(w=>w.outcome==='accepted').length,unknown=writes.filter(w=>w.outcome==='unknown').length;
   const outcome=unknown?'unknown':accepted?'partial':'not_applied';
   return {isError:true,content:[{type:'text',text:error instanceof Error?error.message:String(error)}],
    structuredContent:{mitchExecution:{version:1,outcome,writes:writes.length,accepted,unknown,reason:error.mitchReason||null}}};
  }
 });
}
