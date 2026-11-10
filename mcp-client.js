'use strict';
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {ListRootsRequestSchema}=require('@modelcontextprotocol/sdk/types.js');
const {pathToFileURL}=require('node:url');
async function connectMcp(config,{roots=[],signal}={}){
 const client=new Client({name:'mitch',version:'0.6.0-local.31'},{capabilities:{roots:{listChanged:false}}});
 client.setRequestHandler(ListRootsRequestSchema,async()=>({roots:roots.map(p=>({uri:pathToFileURL(p).href,name:p}))}));
 const transport=config.url?new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers||{}}}):new StdioClientTransport({...config,stderr:'pipe'});
 // Never send subprocess stderr (which can contain OAuth URLs/tokens) to logs or the model.
 transport.stderr?.on('data',()=>{});
 client.onerror=()=>{};
 try{await client.connect(transport,{signal,timeout:45000});}catch(e){await client.close().catch(()=>{});throw e;}
 return {async list(signal){const tools=[];let cursor;do{const page=await client.listTools(cursor?{cursor}:{},{signal,timeout:20000});tools.push(...page.tools);cursor=page.nextCursor;if(tools.length>1000)throw Error('MCP catalog is too large.');}while(cursor);return tools;},
  call:(name,args,signal,timeout=30000)=>client.callTool({name,arguments:args},undefined,{signal,timeout}),close:()=>client.close(),get pid(){return transport.pid;}};
}
module.exports={connectMcp};
