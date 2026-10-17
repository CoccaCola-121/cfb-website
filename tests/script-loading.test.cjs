const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
test('scripts and retries resolve at site root from nested recruit links',()=>{
 for(const [,src,retry] of html.matchAll(/<script src="([^"]+)" onerror="([^"]+)"/g)){
  assert.ok(src.startsWith('/'));
  assert.ok(fs.existsSync(src.slice(1)));
  const script={src,onerror:true};vm.runInNewContext('(function(){'+retry+'}).call(script)',{script});
  assert.equal(new URL(script.src,'https://test/player/recruit').pathname,src);
  assert.equal(script.onerror,null);
 }
});
test('missing offer helper stops before opening the editor and provides reload',()=>{
 let content='';const element={set innerHTML(value){content=value;}};
 const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(source,{document:{getElementById:id=>{assert.equal(id,'rb-app');return element;}}});
 assert.match(content,/Reload RecruitHQ/);assert.match(content,/drafts are kept/);
});
