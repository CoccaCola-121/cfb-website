// One-time correction authorized for the October 2026 HS class. Balances are
// column D of the configured public sheet, verified October 11 before any commits.
// The exact class, source and saved snapshot prevent this from touching later cycles.
const source='https://docs.google.com/spreadsheets/d/11-87AU--uFWHfHCB3S2IbkVOrSNP2X3x1j_M5s1dFys/edit?gid=1039825625';
const balances={
  "boston college": 22,
  "louisville": 29,
  "pittsburgh": 11,
  "navy": 6,
  "wake forest": 32,
  "syracuse": 24,
  "virginia": 16,
  "virginia tech": 13,
  "clemson": 15,
  "florida state": 13,
  "georgia tech": 33,
  "north carolina": 5,
  "miami": 23,
  "army": 30,
  "central florida": 6,
  "duke": 4,
  "ohio state": 9,
  "penn state": 25,
  "michigan": 5,
  "notre dame": 3,
  "rutgers": 2,
  "maryland": 6,
  "western michigan": 7,
  "purdue": 31,
  "wisconsin": 1,
  "michigan state": 9,
  "iowa": 32,
  "nebraska": 14,
  "northwestern": 6,
  "minnesota": 9,
  "illinois": 19,
  "indiana": 29,
  "florida": 4,
  "georgia": 22,
  "ole miss": 10,
  "mississippi state": 32,
  "tennessee": 30,
  "south carolina": 16,
  "kentucky": 32,
  "marshall": 30,
  "alabama": 21,
  "lsu": 8,
  "auburn": 32,
  "texas aandm": 19,
  "missouri": 18,
  "arkansas": 32,
  "vanderbilt": 16,
  "memphis": 32,
  "oregon": 25,
  "utah": 30,
  "washington": 25,
  "boise state": 33,
  "cal": 31,
  "washington state": 21,
  "oregon state": 36,
  "colorado": 13,
  "stanford": 27,
  "usc": 7,
  "arizona": 31,
  "ucla": 11,
  "arizona state": 20,
  "san diego state": 30,
  "new mexico": 11,
  "hawaii": 31,
  "oklahoma": 30,
  "west virginia": 13,
  "kansas state": 33,
  "byu": 29,
  "air force": 24,
  "kansas": 18,
  "iowa state": 17,
  "utah state": 30,
  "oklahoma state": 17,
  "tcu": 7,
  "texas": 13,
  "texas tech": 31,
  "houston": 19,
  "baylor": 26,
  "tulsa": 31,
  "smu": 34,
  "north carolina state": 19,
  "rice": 8,
  "north dakota state": 32,
  "colorado state": 21,
  "appalachian state": 16,
  "uab": 13,
  "florida atlantic": 32,
  "south florida": 33,
  "wyoming": 29,
  "cincinnati": 34,
  "tulane": 35,
  "princeton": 31,
  "fresno state": 18,
  "northern illinois": 1,
  "grambling state": 31,
  "southern mississippi": 35,
  "montana state": 32,
  "north texas": 5,
  "buffalo": 4,
  "unlv": 32,
  "arkansas state": 30,
  "uconn": 20,
  "nevada": 34,
  "toledo": 30,
  "louisiana tech": 31,
  "south dakota state": 33,
  "san jose state": 34,
  "harvard": 10,
  "central michigan": 24,
  "georgia state": 5,
  "yale": 31,
  "ohio": 31,
  "troy": 21,
  "james madison": 30,
  "coastal carolina": 26,
  "montana": 35,
  "alaska anchorage": 6,
  "georgetown": 10,
  "delaware": 10,
  "bowling green": 19
};
const affected={
  o_03t4l1z1:{pid:'r24',name:'Vinnie Tuttle',at:1791598548309},
  o_4mhngn78:{pid:'r8',name:'William Hawkins',at:1791598148891},
  o_67mmkg2x:{pid:'r29',name:'Quinton Kaiser',at:1791598548309},
  o_pes3wfhs:{pid:'r89',name:'No Skillman',at:1791600938080},
  o_9yic5f46:{pid:'r5',name:'Mekel Turner',at:1791600938080}
};
export function repairHsCapacity(state,now=Date.now()){
  const cap=state?.scholarshipCapacity;
  if(state?.recruitingStage!=='hs' || state.prospects?.r1?.name!=='Caspian Maction' ||
    cap?.stage!=='hs' || cap.sourceColumn==='D' || cap.source!==source || cap.updatedAt!==1791562358926 ||
    Object.values(state.prospects || {}).some(p=>p.commitTeam) ||
    Object.keys(cap.teams || {}).length!==Object.keys(balances).length ||
    Object.keys(cap.teams).some(k=>!Object.hasOwn(balances,k)))return null;
  const next=structuredClone(state);
  next.scholarshipCapacity={...next.scholarshipCapacity,sourceColumn:'D',updatedAt:now,correction:'hs-column-d-2026-10-11'};
  for(const [key,row] of Object.entries(next.scholarshipCapacity.teams))row.open=balances[key];
  for(const [id,match] of Object.entries(affected)){
    const p=next.prospects[match.pid];
    const offer=next.offersByProspect?.[match.pid]?.find(o=>o.id===id);
    if(!offer || offer.team!=='Ohio State' || p?.name!==match.name || p.commitTeam ||
      !offer.rescinded || offer.rescindedAt!==match.at || offer.rescindReason!=='Automatic rescind: scholarship cap reached.')continue;
    offer.rescinded=false;
    delete offer.rescindedAt;
    delete offer.rescindReason;
    offer.updatedAt=now;
    offer.editHistory=[...(offer.editHistory || []),{id:'hs-capacity-fix-'+id,editedAt:now,editor:'System correction',changes:['Restored offer after correcting high-school scholarship counts.']}].slice(-20);
  }
  return next;
}
