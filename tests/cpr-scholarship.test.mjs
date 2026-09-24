import test from 'node:test';
import assert from 'node:assert/strict';
import '../cpr-rules.js';
const rules=globalThis.NZCFLCprRules;
test('scholarship cutoffs are exclusive and pitch recruits always qualify',()=>{
  for (const [position,cutoff] of Object.entries(rules.scholarshipCutoffs)) {
    assert.equal(rules.scholarshipRecruit({position,overall:cutoff-1}),false);
    assert.equal(rules.scholarshipRecruit({position,overall:cutoff}),false);
    assert.equal(rules.scholarshipRecruit({position,overall:cutoff+1}),true);
    assert.equal(rules.scholarshipRecruit({position,rating:(cutoff+1)+'/80'}),true);
    assert.equal(rules.scholarshipRecruit({position,overall:cutoff-1,offerMode:'pitch'}),true);
  }
});
