import test from 'node:test';
import assert from 'node:assert/strict';
import '../cpr-rules.js';
const rules=globalThis.NZCFLCprRules;
test('scholarship cutoffs are inclusive and pitch recruits always qualify',()=>{
  for (const [position,cutoff] of Object.entries(rules.scholarshipCutoffs)) {
    assert.equal(rules.scholarshipRecruit({position,overall:cutoff-1}),false);
    assert.equal(rules.scholarshipRecruit({position,overall:cutoff}),true);
    assert.equal(rules.scholarshipRecruit({position,overall:cutoff+1}),true);
    assert.equal(rules.scholarshipRecruit({position,rating:cutoff+'/80'}),true);
    assert.equal(rules.scholarshipRecruit({position,overall:cutoff-1,offerMode:'pitch'}),true);
  }
});

test('active scholarship offers promote a walk-on until the last one is rescinded',()=>{
 const player={position:'QB',overall:30};
 const offers=[{text:'Alabama offers John Smith\nScholarship\n\nWelcome.'},{text:'Army offers John Smith\nScholarship'}];
 assert.equal(rules.scholarshipRecruit(player,offers),true);
 offers[0].rescinded=true;
 assert.equal(rules.scholarshipRecruit(player,offers),true);
 offers[1].rescinded=true;
 assert.equal(rules.scholarshipRecruit(player,offers),false);
 assert.equal(rules.scholarshipRecruit({...player,everScholarship:true},offers),true);
 assert.equal(rules.scholarshipRecruit(player,[{text:'Army offers John Smith\nWalk-On\n\nYou can earn a scholarship later.'}]),false);
});
