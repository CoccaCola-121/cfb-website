(function(root){
  const aliases={'alabama birmingham':'uab','texas christian':'tcu','california':'cal','brigham young':'byu','southern methodist':'smu'};
  const key=value=>{const k=String(value || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim();return aliases[k] || k;};
  const copy=value=>JSON.parse(JSON.stringify(value));
  function rating(p,part=0){
    const raw=part ? p.potential : p.overall;
    const value=raw == null ? String(p.rating || '').split('/')[part] : raw;
    if(value==null || String(value).trim()==='')return null;
    const n=Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function order(a,b){return (rating(a) ?? Infinity)-(rating(b) ?? Infinity) || (rating(a,1) ?? Infinity)-(rating(b,1) ?? Infinity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);}
  function offerKind(state,p,o){
    if(root.NZCFLCprRules.scholarshipOffer(o)) return 'scholarship';
    return 'walkon';
  }
  function conditionalKind(p,o){return p?.offerMode==='pitch'?'scholarship':o?offerKind({},p,o):p?.commitType || null;}
  function scholarshipOnly(state,p){return state.recruitingStage==='transfer' || state.recruitingStage==='cpr' && root.NZCFLCprRules.scholarshipRecruit(p,state.offersByProspect?.[p.id] || []);}
  function invalidOffer(state,p,o){return !!p && scholarshipOnly(state,p) && offerKind(state,p,o)==='walkon';}

  function commitKind(state,id,p){
    if(['scholarship','walkon'].includes(p.commitType)) return p.commitType;
    const winning=(state.offersByProspect?.[id] || []).find(o=>key(o.team)===key(p.commitTeam) && !o.rescinded);
    return winning ? offerKind(state,p,winning) : (state.recruitingStage==='cpr' && !root.NZCFLCprRules.scholarshipRecruit(p) ? 'walkon' : 'scholarship');
  }
  function counts(state){
    const totals={scholarship:{},walkon:{}};
    for(const [id,p] of Object.entries(state.prospects || {})) if(p.commitTeam){const kind=commitKind(state,id,p),t=key(p.commitTeam);totals[kind][t]=(totals[kind][t] || 0)+1;}
    return totals;
  }
  function remaining(state,team,kind,totals=counts(state)){
    const t=key(team);
    if(kind==='walkon') return Math.max(0,15-(totals.walkon[t] || 0));
    const source=state.scholarshipCapacity;
    const row=source?.teams?.[t];
    if(!row || source.stage!==state.recruitingStage || !Number.isInteger(row.open)) return null;
    const bucks=state.bucksRemaining?.[t] ?? 3;
    if(!Number.isInteger(bucks) || bucks<0 || bucks>3) return null;
    return Math.max(0,row.open+bucks-(totals.scholarship[t] || 0)+(source.includedCommits?.[t] || 0));
  }
  function applyScholarshipCap(state,now=Date.now()){
    const totals=counts(state);let changed=0;
    for(const [id,offers] of Object.entries(state.offersByProspect || {})){
      const p=state.prospects?.[id];if(!p || p.commitTeam)continue;
      for(const offer of offers){
        if(offer.rescinded || offerKind(state,p,offer)!=='scholarship' || remaining(state,offer.team,'scholarship',totals)!==0)continue;
        offer.rescinded=true;offer.rescindedAt=now;offer.rescindReason='Automatic rescind: scholarship cap reached.';changed++;
      }
    }
    return changed;
  }
  function parseCapacitySheet(csv){
    const rows=root.NZCFLScholarshipHistory.parseCsv(csv),header=rows.shift() || [];
    if(!/^Total Scholarships Remaining/i.test(String(header[4] || '').trim())) throw Error('Column E must be Total Scholarships Remaining (includes Seniors).');
    const teams={};
    for(const row of rows){
      const name=String(row[0] || '').trim();if(!name || !String(row[1] || '').trim())continue;
      const raw=String(row[4] || '').trim();
      if(!/^-?\d+$/.test(raw)) throw Error('Invalid scholarship count for '+name+' in column E.');
      const t=key(name);if(teams[t])throw Error('Duplicate scholarship team: '+name+'.');
      teams[t]={team:name,open:Number(raw)};
    }
    if(!Object.keys(teams).length) throw Error('No scholarship counts found in column E.');
    return teams;
  }
  function fingerprint(state){
    return JSON.stringify([state.recruitingStage,state.offersLocked,state.offerSchedule,state.prospects,state.offersByProspect,state.scholarshipCapacity,state.bucksRemaining,state.conditionalRescinds]);
  }
  function validate(state){
    for(const [team,value] of Object.entries(state.bucksRemaining || {})) if(!Number.isInteger(value)||value<0||value>3)return 'Bucks spots for '+team+' must be a whole number from 0 to 3.';
    const cap=state.scholarshipCapacity;if(!cap)return '';
    if(!['hs','cpr','transfer'].includes(cap.stage))return 'Scholarship capacity must belong to a recruiting stage.';
    for(const row of Object.values(cap.teams || {}))if(!Number.isInteger(row.open))return 'Scholarship counts must be whole numbers.';
    for(const value of Object.values(cap.includedCommits || {}))if(!Number.isInteger(value)||value<0)return 'Included scholarship commitments must be nonnegative whole numbers.';
    return '';
  }
  function preview(state,kind,now=Date.now()){
    const result={kind,commits:[],rescinds:[],errors:[],contested:0};
    if(!['scholarship','walkon'].includes(kind)){result.errors.push('Choose scholarships or walk-ons.');return result;}
    if(!root.NZCFLOfferWindow.locked(state,now)){result.errors.push('Close offers before producing auto-commits.');return result;}
    const invalid=validate(state);if(invalid){result.errors.push(invalid);return result;}
    if(kind==='walkon' && state.recruitingStage==='transfer'){result.errors.push('Transfer recruiting has no walk-on autos.');return result;}
    if(!state.scholarshipCapacity || state.scholarshipCapacity.stage!==state.recruitingStage){result.errors.push('Read scholarship counts for this class first.');return result;}
    // Walk-ons run only after the scholarship pass is applied. Contested scholarships
    // remain ineligible for walk-on autos, even if they also have walk-on offers.
    if(kind==='walkon'){
      const schol=preview(state,'scholarship',now);
      if(schol.errors.length){result.errors=schol.errors;return result;}
      if(schol.commits.length || schol.rescinds.length){result.errors.push('Run scholarship autos first. Scholarship and walk-on limits are separate.');return result;}
    }
    const work=copy(state);
    const players=Object.entries(work.prospects || {}).map(([id,p])=>({...p,id})).sort(order);
    const missing=new Set();
    for(const p of players)if(!p.commitTeam)for(const o of work.offersByProspect?.[p.id] || []){
      if(!o.rescinded && remaining(work,o.team,'scholarship')===null) missing.add(o.team);
    }
    if(missing.size){result.errors.push('Missing scholarship counts or Bucks allowances: '+[...missing].sort().join(', ')+'.');return result;}
    function rescind(p,o,reason){
      if(o.rescinded)return;o.rescinded=true;o.rescindedAt=now;o.rescindReason=reason;
      result.rescinds.push({prospectId:p.id,offerId:o.id,team:o.team,reason});
    }
    function applyLimits(){
      const totals=counts(work);
      for(const p of players){
        if(work.prospects[p.id].commitTeam)continue;
        for(const o of work.offersByProspect?.[p.id] || []){
          if(o.rescinded)continue;
          const type=offerKind(work,p,o);
          if(type==='scholarship' && remaining(work,o.team,'scholarship',totals)===0)rescind(p,o,'Automatic rescind: scholarship cap reached.');
          if(kind==='walkon' && type==='walkon' && remaining(work,o.team,'walkon',totals)===0)rescind(p,o,'Automatic rescind: 15 walk-on commitments reached.');
        }
      }
    }
    function conditionalRules(){
      const stars=p=>p.rank<=25?5:p.rank<=250?4:p.rank<=500?3:p.rank<=900?2:p.rank<=1700?1:0;
      function matches(rule,p,o){
        const ids=rule.playerIds || rule.triggerIds;
        if(ids?.length)return ids.includes(p.id);
        const positions=Array.isArray(rule.positions)?rule.positions:String(rule.position || '').split(',').map(x=>x.trim()).filter(Boolean);
        if(positions.length && !positions.includes(p.position))return false;
        if(rule.stars!=='' && rule.stars!=null && stars(p)!==Number(rule.stars))return false;
        if(Number(rule.rankValue)>0 && (rule.rankMode==='better'?p.rank>Number(rule.rankValue):p.rank<=Number(rule.rankValue)))return false;
        if(Number(rule.overallValue)>0 && (rating(p)===null || (rule.overallMode==='below'?rating(p)>=Number(rule.overallValue):rule.overallMode==='atMost'?rating(p)>Number(rule.overallValue):rating(p)<Number(rule.overallValue))))return false;
        return !rule.scholarship || conditionalKind(p,o)===rule.scholarship;
      }
      for(const rule of work.conditionalRescinds || []){
        if(!rule.enabled || !rule.team)continue;
        const t=key(rule.team);
        const won=players.filter(p=>key(work.prospects[p.id].commitTeam)===t && matches(rule,p,(work.offersByProspect?.[p.id] || []).find(o=>!o.rescinded && key(o.team)===t)));
        if(won.length<Math.max(1,Number(rule.count)||0))continue;
        const targetRule=rescindTargetRule(rule,won);
        if(!targetRule)continue;
        for(const p of players)if(!work.prospects[p.id].commitTeam)for(const o of work.offersByProspect?.[p.id] || [])if(!o.rescinded && key(o.team)===t && matches(targetRule,p,o))rescind(p,o,'Conditional rescind: '+(rule.name || 'rule met'));
      }
    }
    function candidates(p){
      const all=(work.offersByProspect?.[p.id] || []).filter(o=>!o.rescinded);
      const scholarships=all.filter(o=>offerKind(work,p,o)==='scholarship');
      if(kind==='walkon' && (scholarshipOnly(work,p) || scholarships.length))return [];
      const eligible=kind==='scholarship'?scholarships:all.filter(o=>offerKind(work,p,o)==='walkon');
      return [...new Map(eligible.map(o=>[key(o.team),o])).values()];
    }
    while(true){
      applyLimits();conditionalRules();
      const p=players.find(p=>!work.prospects[p.id].commitTeam && candidates(p).length===1);
      if(!p)break;
      if(rating(p)===null){result.errors.push('Missing overall for '+p.name+'. Correct it before producing autos.');result.commits=[];result.rescinds=[];return result;}
      const offer=candidates(p)[0];
      work.prospects[p.id].commitTeam=offer.team;work.prospects[p.id].commitType=kind;
      result.commits.push({prospectId:p.id,name:p.name,position:p.position,overall:rating(p),potential:rating(p,1),team:offer.team,offerId:offer.id,kind});
    }
    result.contested=players.filter(p=>!work.prospects[p.id].commitTeam && candidates(p).length>1).length;
    return result;
  }
  function apply(state,kind,now=Date.now()){
    const result=preview(state,kind,now);if(result.errors.length)throw Error(result.errors.join(' '));
    state.manualCommitOverrides ||= {};
    for(const row of result.commits){
      const p=state.prospects[row.prospectId];p.commitTeam=row.team;p.commitType=kind;
      state.manualCommitOverrides[row.prospectId]={team:row.team,name:p.name,stage:state.recruitingStage,updatedAt:now,commitType:kind,source:'auto'};
    }
    for(const row of result.rescinds){const o=(state.offersByProspect[row.prospectId] || []).find(o=>o.id===row.offerId);if(o){o.rescinded=true;o.rescindedAt=now;o.rescindReason=row.reason;}}
    if(result.commits.length)state.commitUpdatedAt=now;
    return result;
  }
  function relativeOverall(mode){ return mode==='belowCommit' || mode==='atMostCommit'; }
  function rescindTargetRule(rule, commits, getOverall=rating){
    rule={...rule,triggerIds:undefined,playerIds:rule.targetIds || []};
    if (!relativeOverall(rule.overallMode)) return rule;
    const values=commits.map(p=>getOverall(p));
    if (!values.length || values.some(v=>v==null || !Number.isFinite(v))) return null;
    return {...rule,overallMode:rule.overallMode==='belowCommit'?'below':'atMost',overallValue:Math.min(...values)};
  }
  root.NZCFLAutoCommits={applyScholarshipCap,conditionalKind,invalidOffer,relativeOverall,rescindTargetRule,key,rating,offerKind,commitKind,counts,remaining,parseCapacitySheet,validate,fingerprint,preview,apply};
})(globalThis);
