import {extractCprMetadata,readLeagueExport} from './cpr-metadata.mjs';
self.onmessage=async ({data})=>{
  try { const result=extractCprMetadata(await readLeagueExport(data.file),data.roster); self.postMessage({ok:true,result}); }
  catch(error) { self.postMessage({ok:false,error:error.message || 'Could not read export.'}); }
};
