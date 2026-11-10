// A successful HTTP write is an acknowledgement, not playback evidence.
// Stay inside the provider: bounded read-only checks, no model round trip or replay.
export async function preparePlayback(uri,albumUri,readTrack){
 const match=/^spotify:(track|album|artist|playlist):([A-Za-z0-9]{22})$/.exec(uri);
 if(!match)throw Error('Provide a valid Spotify track, album, artist or playlist URI.');
 if(match[1]!=='track')return {body:{context_uri:uri},albumContext:false};
 // Desktop clients currently acknowledge bare track lists while clearing playback.
 // Resolve the album before the single write, then start at the exact requested URI.
 if(!albumUri)albumUri=(await readTrack(match[2]))?.album?.uri;
 if(!/^spotify:album:[A-Za-z0-9]{22}$/.test(albumUri||''))throw Error('Spotify did not provide an album for the requested track. No playback request was sent.');
 return {body:{context_uri:albumUri,offset:{uri},position_ms:0},albumContext:true};
}

export async function confirmPlayback(readState,{uri,deviceId,delays=[0,250,500,1000,2000],wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 let lastReadFailed=false;
 for(const delay of delays){
  if(delay)await wait(delay);
  let state;
  try{state=await readState();lastReadFailed=false;}catch{lastReadFailed=true;continue;}
  const requested=uri.startsWith('spotify:track:')
   ?state?.item?.uri===uri||state?.item?.linked_from?.uri===uri
   :state?.context?.uri===uri;
  if(state?.is_playing===true&&requested&&(!deviceId||state.device?.id===deviceId))return state;
 }
 throw Object.assign(new Error('Spotify accepted the playback request, but '+(lastReadFailed?'its playback state could not be read.':'it did not report the requested music playing.')+' No second playback request was sent. Check the player in Spotify.'),{mitchReason:'playback_unconfirmed'});
}
