// Removal records are scoped to the uploaded class; keeping the CSV cannot recreate a removed player.
export function classKey(state){
 const rows=state.fullRoster || [],first=rows[0] || {},last=rows.at(-1) || {};
 return JSON.stringify([state.recruitingStage,rows.length,first.metadataSeason || first.season || '',first.name,last.name]);
}
export function removedPlayer(state,player){
 return Object.values(state.removedPlayers || {}).some(r=>r.classKey===classKey(state) && r.player.name===player.name && r.player.position===player.position && String(r.player.rank)===String(player.rank));
}
export function applyRemovedPlayers(state){
 for(const [id,p] of Object.entries(state.prospects || {})){
  if(!removedPlayer(state,p))continue;
  delete state.prospects[id];
  delete state.offersByProspect?.[id];
  delete state.manualCommitOverrides?.[id];
  if(state.released)delete state.released[p.rank];
  state.threads=(state.threads || []).map(t=>({...t,prospectIds:(t.prospectIds || []).filter(pid=>pid!==id)})).filter(t=>t.prospectIds.length);
 }
}
