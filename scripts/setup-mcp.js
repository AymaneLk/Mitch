'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'outputs','mcp-runtime'),nodeDir=path.join(runtime,'node'),pythonDir=path.join(runtime,'python');
fs.mkdirSync(runtime,{recursive:true});
function run(command,args){execFileSync(command,args,{cwd:root,stdio:'inherit',windowsHide:true});}
if(!process.argv.includes('--configure-only')){
 const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
 run(process.execPath,[npm,'install','--prefix',nodeDir,'--save-exact','@modelcontextprotocol/server-filesystem@2.2.0','@wonderwhy-er/desktop-commander@0.3.1','@playwright/mcp@0.0.85','@xavifabregat/spotify-mcp@0.1.2','--cache',path.join(root,'outputs/npm-cache'),'--no-fund','--ignore-scripts']);
 const uv=process.env.MITCH_UV||path.join(require('node:os').homedir(),'.local/bin/uv.exe');
 if(!fs.existsSync(path.join(pythonDir,'Scripts/python.exe')))run(uv,['venv',pythonDir,'--python','3.12','--cache-dir',path.join(root,'outputs/uv-cache')]);
 run(uv,['pip','install','--python',path.join(pythonDir,'Scripts/python.exe'),'workspace-mcp==2.4.0','excel-mcp-server==2.3.0','--cache-dir',path.join(root,'outputs/uv-cache')]);
}
const modulePath=p=>path.join(nodeDir,'node_modules',p);
// Isolate the two upstream home-directory stores without changing HOME or
// USERPROFILE, or touching another client's credentials/configuration.
function patch(file,original,replacement){let code=fs.readFileSync(file,'utf8');if(code.includes(replacement))return;if(!code.includes(original))throw Error('Provider isolation patch no longer matches: '+file);fs.writeFileSync(file,code.replace(original,replacement));}
patch(modulePath('@wonderwhy-er/desktop-commander/dist/config.js'),"const CONFIG_DIR = path.join(USER_HOME, '.claude-server-commander');","const CONFIG_DIR = process.env.MITCH_MCP_STATE_DIR || path.join(USER_HOME, '.claude-server-commander');");
patch(modulePath('@wonderwhy-er/desktop-commander/dist/utils/toolHistory.js'),"const historyDir = path.join(os.homedir(), '.claude-server-commander');","const historyDir = process.env.MITCH_MCP_STATE_DIR || path.join(os.homedir(), '.claude-server-commander');");
patch(modulePath('@xavifabregat/spotify-mcp/dist/auth.js'),'const TOKEN_DIR = join(homedir(), ".spotify-mcp");','const TOKEN_DIR = process.env.MITCH_MCP_STATE_DIR || join(homedir(), ".spotify-mcp");');
const spotifyDist=modulePath('@xavifabregat/spotify-mcp/dist');
fs.copyFileSync(path.join(root,'mcp-provider-outcome.mjs'),path.join(spotifyDist,'mitch-outcome.js'));
fs.copyFileSync(path.join(root,'mcp-provider-playback.mjs'),path.join(spotifyDist,'mitch-playback.js'));
patch(path.join(spotifyDist,'spotify.js'),'import { getAccessToken } from "./auth.js";','import { getAccessToken } from "./auth.js";\nimport { trackedFetch } from "./mitch-outcome.js";');
patch(path.join(spotifyDist,'spotify.js'),'const res = await fetch(url, {','const res = await trackedFetch(url, {');
patch(path.join(spotifyDist,'tools/util.js'),'import { NoActiveDeviceError } from "../errors.js";','import { NoActiveDeviceError } from "../errors.js";\nimport { runWithOutcome } from "../mitch-outcome.js";');
patch(path.join(spotifyDist,'tools/util.js'),'return ok(await fn(args));','return await runWithOutcome(() => fn(args));');
patch(path.join(spotifyDist,'tools/util.js'),'throw new ToolMessageError(deviceChoiceMessage(devices));','throw Object.assign(new ToolMessageError(deviceChoiceMessage(devices)), {mitchReason: devices.length === 0 ? "device_unavailable" : "device_selection_required"});');
patch(path.join(spotifyDist,'tools/playback.js'),'import { run, withDeviceFallback } from "./util.js";','import { run, withDeviceFallback } from "./util.js";\nimport { confirmPlayback, preparePlayback } from "../mitch-playback.js";');
patch(path.join(spotifyDist,'tools/playback.js'),'const { deviceNote } = await withDeviceFallback((dev) => spotify.startPlayback(body, args.device_id ?? dev));','let playbackDevice;\n        const { deviceNote } = await withDeviceFallback((dev) => { playbackDevice = args.device_id ?? dev; return spotify.startPlayback(body, playbackDevice); });\n        await confirmPlayback(() => spotify.getPlaybackState(), {uri, deviceId: playbackDevice});');
patch(path.join(spotifyDist,'spotify.js'),'export const getDevices = async () => (await request("/me/player/devices")).devices;','export const getDevices = async () => (await request("/me/player/devices")).devices;\nexport const getTrack = (id) => request("/tracks/" + encodeURIComponent(id));');
patch(path.join(spotifyDist,'tools/playback.js'),'return t ? { uri: t.uri, label: trackLine(t) } : null;','return t ? { uri: t.uri, label: trackLine(t), albumUri: t.album?.uri } : null;');
patch(path.join(spotifyDist,'tools/playback.js'),'let uri = args.uri;\n        let label = uri ?? "";','let uri = args.uri;\n        let albumUri;\n        let label = uri ?? "";');
patch(path.join(spotifyDist,'tools/playback.js'),'uri = match.uri;\n            label = match.label;','uri = match.uri;\n            albumUri = match.albumUri;\n            label = match.label;');
patch(path.join(spotifyDist,'tools/playback.js'),'const kind = uri.split(":")[1];\n        const body = kind === "track" ? { uris: [uri] } : { context_uri: uri };','const {body, albumContext} = await preparePlayback(uri, albumUri, spotify.getTrack);');
patch(path.join(spotifyDist,'tools/playback.js'),'return `▶ Now playing${deviceNote}: ${label}`;','return `▶ Now playing${deviceNote}: ${label}${albumContext ? "\\nStarted at the requested track in its album; Spotify may continue with following album tracks." : ""}`;');
// Mitch owns the browser handoff. Normal reads must never initiate OAuth, and
// explicit authorization returns a URL instead of opening a second browser tab.
const googleAuth=path.join(pythonDir,'Lib/site-packages/auth/google_auth.py');
patch(googleAuth,'get_transport_mode() == "stdio" and not is_oauth21_enabled()', 'get_transport_mode() == "stdio" and not is_oauth21_enabled()\n            and os.getenv("MITCH_MCP_NO_AUTO_BROWSER") != "1"');
patch(googleAuth,'    if not credentials or not credentials.valid:\n        logger.warning(', '    if not credentials or not credentials.valid:\n        if os.getenv("MITCH_MCP_EXPLICIT_AUTH_ONLY") == "1":\n            raise GoogleAuthenticationError("Account authorization required. Use Mitch Settings to authorize explicitly.")\n        logger.warning(');
const manifest={version:1,
 filesystem:{command:process.execPath,args:[modulePath('@modelcontextprotocol/server-filesystem/dist/index.js')]},
 desktop:{command:process.execPath,args:[modulePath('@wonderwhy-er/desktop-commander/dist/index.js')]},
 spotify:{command:process.execPath,args:[modulePath('@xavifabregat/spotify-mcp/dist/index.js')]},
 playwright:{command:process.execPath,args:[modulePath('@playwright/mcp/cli.js')]},
 google:{command:path.join(pythonDir,'Scripts/workspace-mcp.exe'),args:['--transport','stdio','--tool-tier','complete','--tools','gmail','drive','calendar','docs','sheets','slides','forms','tasks','contacts','chat','appscript']},
 excel:{command:path.join(pythonDir,'Scripts/excel-mcp-server.exe'),args:['stdio']},
};
fs.writeFileSync(path.join(runtime,'mcp-runtime.json'),JSON.stringify(manifest,null,2));
console.log('MCP runtime manifest ready:',path.join(runtime,'mcp-runtime.json'));
