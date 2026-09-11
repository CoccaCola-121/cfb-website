const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const rootDir = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
const boot = script.lastIndexOf('\napplyRoute(routeFromPath(window.location.pathname));');
assert(boot > 0, 'The app bootstrap must be identifiable without executing network requests.');
const source = script.slice(0, boot) + `
  globalThis.app = { DB, UI, beginSettingsDraft, hasSettingsChanges, canLeaveSettings, saveSettingsChanges, saveDBNow, leagueStatePayload, mergeSettingsValue, updateCommitsFromSheet, runBackupNow, setTransferFilter, renderTransferFilters, renderClassSetup, requestManualCommitOverride, applyManualCommitOverride, requestClearCommit, clearManualCommitOverride, applyManualCommitOverrides, clearRecruitingBoard, findProspectFromSheetRow, transferCardStyle, parseFullClass, prospectFromRosterRow, confirmTransferImport, releaseSingleStageBoard, addOfferDirect, render, renderNav, navigateTo, setReady(){ dbReady = true; sessionReady = true; }, renderFeed, renderBoardSearchResults, renderTeamsPage,
    renderThreadProspectList, renderProspectDetail, builtInTeamBranding, getTeamBranding, activeTeamBrands,
    mobileRecruitName, renderRecruitName, renderMyOffers, renderCommitsForTeam, renderTeamOffers, renderConditionalRescinds, renderRecruitValues, teamBorderColor, bindEvents, applyDefaultClassData, releaseWave1, releaseWave2,
    setSession(value){ SESSION = value; } };
})();`;

function element(attributes = {}) {
  return { style: {}, value: '', classList: { toggle(){} },
    getAttribute(name){ return attributes[name] ?? null; },
    setAttribute(name, value){ attributes[name] = value; } };
}

// Only the DOM surface used by these handlers is needed; no live account,
// browser, storage, or API is involved in these rendering regressions.
function harness() {
  const elements = { 'rb-app': element() };
  let cards = [];
  let commitLinks = [];
  const results = element();
  let resultHTML = '';
  Object.defineProperty(results, 'innerHTML', {
    get(){ return resultHTML; },
    set(html){
      resultHTML = html;
      function nodes(attribute) {
        return [...html.matchAll(new RegExp('<[^>]+\\b' + attribute + '="[^"]*"[^>]*>', 'g'))]
          .map(match => element(Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]]))));
      }
      cards = nodes('data-prospect-card');
      commitLinks = nodes('data-open-team-commits');
    }
  });
  const document = {
    getElementById(id){ return elements[id] || null; },
    querySelector(){ return null; },
    querySelectorAll(selector){
      if (selector === '[data-open-prospect]' || selector === '[data-prospect-card]') return cards;
      if (selector === '[data-open-team-commits]') return commitLinks;
      return [];
    }
  };
  const window = {
    location: { protocol: 'file:', pathname: '/', search: '' },
    localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
    history: { pushState(){}, replaceState(){} }, scrollTo(){}, addEventListener(){}
  };
  const context = vm.createContext({ window, document, navigator: {}, console,
    setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
    fetch(){ throw new Error('Regression checks must not contact a live API.'); }
  });
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'team-branding.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'transfer-rules.js'), 'utf8'), context);
  vm.runInContext(source, context);
  const { app } = context;
  app.setSession({ team: 'Michigan State', username: 'Test coach', discordId: 'fixture', accessLevel: 'coach' });
  app.DB.prospects = {
    r1: { id: 'r1', rank: 1, name: 'Jordan Able', position: 'QB', hometown: 'Akron, OH', commitTeam: 'Boise State' },
    r2: { id: 'r2', rank: 2, name: 'Morgan Baker', position: 'WR', hometown: 'Austin, TX', commitTeam: '' },
    r3: { id: 'r3', rank: 3, name: 'Casey Cole', position: 'RB', hometown: 'Boston, MA', commitTeam: '' }
  };
  app.DB.threads = [
    { id: 'wave1', title: '5 Star Recruiting Board', stars: 5, prospectIds: ['r1', 'r2'] },
    { id: 'wave2', title: '4 Star Recruiting Board', stars: 4, prospectIds: ['r3', 'missing'] }
  ];
  return { app, context, elements, results, getCards: () => cards, getCommitLinks: () => commitLinks };
}

function prospectIDs(html) {
  return [...html.matchAll(/data-prospect-card="1"[^>]*data-open-prospect="([^"]+)"/g)].map(match => match[1]);
}

test('opening the board renders summaries without hidden recruit cards', () => {
  const { app } = harness();
  const html = app.renderFeed();
  assert.equal((html.match(/data-open-thread=/g) || []).length, 2);
  assert.deepEqual(prospectIDs(html), []);
  assert.match(html, /3 prospects/);
  assert.match(html, /#1&ndash;2/);
  assert.match(html, /id="rb-board-player-results"[^>]*><\/div>/);
});

test('search matches names, ranks and hometowns without rendering unrelated recruits', () => {
  const { app } = harness();
  for (const [query, expected] of [[' MORGAN ', ['r2']], ['#1', ['r1']], ['boston', ['r3']], ['2', ['r2']], ['o', ['r1', 'r2', 'r3']]]) {
    assert.deepEqual(prospectIDs(app.renderBoardSearchResults(query)), expected);
  }
  assert.equal(app.renderBoardSearchResults('  '), '');
  assert.match(app.renderBoardSearchResults('unknown prospect'), /No recruits match that search/);
});

test('search respects committed/uncommitted filters and fresh league updates', () => {
  const { app } = harness();
  app.UI.boardCommitFilter = 'committed';
  assert.deepEqual(prospectIDs(app.renderBoardSearchResults('o')), ['r1']);
  app.UI.boardCommitFilter = 'uncommitted';
  assert.deepEqual(prospectIDs(app.renderBoardSearchResults('o')), ['r2', 'r3']);
  app.DB.prospects.r2.commitTeam = 'Michigan State';
  assert.deepEqual(prospectIDs(app.renderBoardSearchResults('morgan')), []);
  app.UI.boardCommitFilter = 'all';
  app.DB.prospects.r2.name = 'Renamed Recruit';
  assert.deepEqual(prospectIDs(app.renderBoardSearchResults('morgan')), []);
  assert.deepEqual(prospectIDs(app.renderBoardSearchResults('renamed')), ['r2']);
});

test('single-board recruiting stages still expose their recruits immediately', () => {
  const { app } = harness();
  app.DB.recruitingStage = 'transfer';
  app.DB.threads = [app.DB.threads[0]];
  const html = app.renderFeed();
  assert.match(html, /data-thread-search="wave1"/);
  assert.deepEqual(prospectIDs(html), ['r1', 'r2']);
});

test('dynamically rendered results retain recruit, commitment and offer-detail actions', () => {
  const h = harness();
  h.elements['rb-board-search'] = element();
  h.elements['rb-board-cards'] = element();
  h.elements['rb-board-player-results'] = h.results;
  h.app.bindEvents();
  const input = h.elements['rb-board-search'];
  input.value = 'jordan'; input.oninput();
  assert.equal(h.elements['rb-board-cards'].style.display, 'none');
  assert.deepEqual(prospectIDs(h.results.innerHTML), ['r1']);
  assert.equal(typeof h.getCards()[0].onclick, 'function');
  assert.equal(typeof h.getCommitLinks()[0].onclick, 'function');
  const event = { preventDefault(){}, stopPropagation(){}, target: { closest(){ return null; } } };
  h.getCommitLinks()[0].onclick(event);
  assert.equal(h.app.UI.view, 'teamcommits');
  assert.equal(h.app.UI.teamCommitsTeam, 'Boise State');
  assert.equal(h.app.UI.teamCommitsReturn.view, 'feed');
  h.app.UI.view = 'feed';
  h.getCards()[0].onclick({ ...event, target: { closest(){ return {}; } } });
  assert.equal(h.app.UI.view, 'feed', 'Expanding an offer must not navigate to its recruit.');
  h.getCards()[0].onclick(event);
  assert.equal(h.app.UI.view, 'prospect');
  assert.equal(h.app.UI.prospectId, 'r1');
  input.value = ''; input.oninput();
  assert.equal(h.elements['rb-board-cards'].style.display, 'flex');
  assert.equal(h.results.style.display, 'none');
  assert.equal(h.results.innerHTML, '');
});

test('cached built-in branding preserves live overrides, aliases and replacements', () => {
  const { app, context } = harness();
  const first = app.builtInTeamBranding();
  assert.equal(app.builtInTeamBranding(), first);
  assert.equal(app.getTeamBranding('California').region, 'Cal');
  app.DB.teamBranding.cal = { region: 'Cal', primary: '#abcdef' };
  assert.equal(app.getTeamBranding('Cal').primary, '#abcdef');
  app.DB.teamBranding.cal.primary = '#123456';
  assert.equal(app.getTeamBranding('California').primary, '#123456');
  app.DB.teamBranding = {};
  assert.equal(app.getTeamBranding('Cal').primary, first.cal.primary);
  context.window.NZCFL_TEAM_BRANDS = [{ region: 'Test School', primary: '#123abc' }];
  assert.equal(app.getTeamBranding('Test School').primary, '#123abc');
  assert.equal(app.activeTeamBrands().length, 1);
});

test('team borders remain visible for every built-in school, including navy and black', () => {
  const { app, context } = harness();
  function luminance(hex) {
    const rgb = hex.match(/[\da-f]{2}/gi).map(part => parseInt(part, 16) / 255);
    const linear = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return linear.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  }
  const background = luminance('#1c1d1f');
  for (const brand of context.window.NZCFL_TEAM_BRANDS) {
    const color = app.teamBorderColor(brand);
    assert.match(color, /^#[\da-f]{6}$/i);
    assert((luminance(color) + 0.05) / (background + 0.05) >= 3, brand.region);
  }
  assert.equal(app.teamBorderColor({ primary: '#ffffff' }), '#ffffff');
  assert.equal(app.teamBorderColor({ primary: '#fff' }), '#ffffff');
  assert.equal(app.teamBorderColor({ primary: 'invalid' }), '#85888b');
});

test('coached and uncoached teams share row sizing and retain commissioner controls', () => {
  const { app } = harness();
  app.setSession({ team: 'Michigan State', accessLevel: 'commissioner' });
  app.UI.teamLinks = { 'bowling green': { team: 'Bowling Green', discordId: 'coach-1', displayName: 'adm', accessLevel: 'moderator' } };
  const html = app.renderTeamsPage();
  const openings = [...html.matchAll(/<div class="rb-card rb-team-card"[^>]+>/g)].map(match => match[0]);
  assert(openings.length > 100);
  assert(openings.every(tag => !/padding:|height:|border-color:/.test(tag)), 'Team rows must share CSS sizing instead of per-team dimensions.');
  assert.match(html, /data-admin-unlink-team="Bowling Green"/);
  assert.match(html, /data-admin-change-team="coach-1"/);
  assert.match(html, /data-admin-access-level="coach-1"/);
  assert.match(html, /No Discord linked/);
});

test('the full bundled class stays lightweight before a search', () => {
  const { app, context } = harness();
  app.DB.threads = []; app.DB.prospects = {};
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'default-class-2062.js'), 'utf8'), context);
  assert(app.applyDefaultClassData(context.window.NZCFL_DEFAULT_CLASS_CSV));
  app.releaseWave1(); app.releaseWave2();
  assert(Object.keys(app.DB.prospects).length > 2000);
  const html = app.renderFeed();
  assert.deepEqual(prospectIDs(html), []);
  assert(Buffer.byteLength(html) < 10000, 'Board markup must not include a hidden copy of the full class.');
});

test('a recruit committed to the viewing coach gets the gold title and explicit indicator', () => {
  const { app } = harness();
  app.UI.prospectId = 'r1';
  app.setSession({ team: 'Boise State', accessLevel: 'coach' });
  const html = app.renderProspectDetail();
  assert.match(html, /class="rb-h rb-prospect-title-owned"[^>]*>#1 Jordan Able<\/div>/);
  assert.match(html, /Committed to your team/);
  assert.match(html, /data-open-team-commits="Boise State"/);
  assert(!html.includes('data-open-submit='));
  app.DB.prospects.r1.commitTeam = 'Cal';
  app.setSession({ team: 'California', accessLevel: 'coach' });
  assert.match(app.renderProspectDetail(), /Committed to your team/);
});

test('own-commit styling clears when the viewer or recruit commitment changes', () => {
  const { app } = harness();
  app.UI.prospectId = 'r1';
  for (const session of [null, { team: '' }, { team: 'Michigan State' }]) {
    app.setSession(session);
    const html = app.renderProspectDetail();
    assert(!html.includes('rb-prospect-title-owned'));
    assert(!html.includes('Committed to your team'));
  }
  app.setSession({ team: 'Boise State' });
  assert.match(app.renderProspectDetail(), /Committed to your team/);
  app.DB.prospects.r1.commitTeam = '';
  const html = app.renderProspectDetail();
  assert(!html.includes('rb-prospect-title-owned'));
  assert(!html.includes('Committed to your team'));
  assert.match(html, /data-open-submit="r1"/);
});


test('mobile names abbreviate first names without losing surnames or suffixes', () => {
  const { app } = harness();
  for (const [full, compact] of [['Shane Starks', 'S. Starks'], ['Pharaoh Lizotte', 'P. Lizotte'], ['John James Smith Jr.', 'J. Smith Jr.'], ['Alex de la Cruz', 'A. de la Cruz'], ['Prince', 'Prince']]) {
    assert.equal(app.mobileRecruitName(full), compact);
    const html = app.renderRecruitName(full);
    assert.ok(html.includes('rb-desktop-only">' + full));
    assert.ok(html.includes('rb-mobile-only">' + compact));
  }
  assert.ok(!app.renderRecruitName('<img> Smith').includes('<img>'));
});

test('mobile presentation preserves full-name search, recruit details, and commitment actions', () => {
  const { app } = harness();
  app.DB.prospects.r1.name = 'Pharaoh Lizotte';
  app.DB.prospects.r1.rating = 91;
  const html = app.renderBoardSearchResults('Pharaoh Lizotte');
  assert.match(html, /rb-mobile-only">P\. Lizotte/);
  assert.match(html, /QB<span class="rb-recruit-rating"> &middot; 91/);
  assert.match(html, /aria-label="Committed to Boise State"/);
  assert.match(html, /data-open-team-commits="Boise State"/);
  app.UI.prospectId = 'r1';
  assert.match(app.renderProspectDetail(), /#1 Pharaoh Lizotte<\/div>/);
});

test('offer and commit lists keep balanced markup and full data with mobile names', () => {
  const { app } = harness();
  app.DB.offersByProspect.r1 = [{ id: 'o1', team: 'Boise State', text: 'Welcome', visits: {}, promises: [] }];
  app.setSession({ team: 'Boise State', username: 'Coach', accessLevel: 'coach' });
  app.UI.teamOffersTeam = 'Boise State';
  for (const html of [app.renderMyOffers(), app.renderTeamOffers(), app.renderCommitsForTeam('Boise State', 'Commits')]) {
    assert.match(html, /rb-mobile-only">J\. Able/);
    for (const tag of ['span', 'div', 'strong', 'details', 'summary']) {
      const tokens = html.match(new RegExp('<\\/?' + tag + '(?:\\s[^>]*|)>', 'g')) || [];
      let depth = 0;
      for (const token of tokens) {
        depth += token.startsWith('</') ? -1 : 1;
        assert.ok(depth >= 0, tag + ' closes before opening');
      }
      assert.equal(depth, 0, tag + ' must stay balanced');
    }
  }
  const rescind = app.renderConditionalRescinds();
  for (const prefix of ['rb-cond', 'rb-mass']) {
    for (const field of ['stars', 'scholarship', 'rank-mode', 'rank-value', 'overall-mode', 'overall-value']) {
      assert.ok(rescind.includes('id="' + prefix + '-' + field + '"'));
    }
  }
});


test('switching tabs preserves the horizontal navigation scroll after replacing the page', () => {
  const { app, elements } = harness();
  app.setReady();
  app.DB.unmatched = [];
  let markup = '';
  Object.defineProperty(elements['rb-app'], 'innerHTML', {
    get(){ return markup; },
    set(html){
      markup = html;
      elements['rb-main-nav'] = { scrollLeft: 0 };
    }
  });
  elements['rb-main-nav'] = { scrollLeft: 137 };
  app.navigateTo('myoffers');
  assert.equal(elements['rb-main-nav'].scrollLeft, 137);
  assert.match(markup, /data-nav="myoffers" aria-current="page"/);
  elements['rb-main-nav'].scrollLeft = 64;
  app.navigateTo('mycommits');
  assert.equal(elements['rb-main-nav'].scrollLeft, 64);
  app.render();
  assert.equal(elements['rb-main-nav'].scrollLeft, 64);
});

test('navigation keeps desktop labels and supplies compact mobile labels', () => {
  const { app } = harness();
  const html = app.renderNav();
  assert.match(html, /rb-desktop-only">My Offers<\/span><span class="rb-mobile-only">Offers/);
  assert.match(html, /rb-desktop-only">My Commits<\/span><span class="rb-mobile-only">Commits/);
  assert.match(html, />Prospect Board<\/button>/);
  assert.match(html, />Teams<\/button>/);
});


test('transfer board opens directly in source order with metadata and no values or tiers', () => {
  const { app } = harness();
  app.DB.recruitingStage = 'transfer';
  app.DB.prospects.r1 = { ...app.DB.prospects.r1, transferFrom: 'UAB', grade: 'RS JR', yearsLeft: 2, brokenPromise: 'Start every game', prompt: 'Explain your plan.', sourceOrder: 0, values: {coach: 0.9} };
  app.DB.prospects.r2 = { ...app.DB.prospects.r2, transferFrom: 'Baylor', sourceOrder: 1 };
  app.DB.prospects.r3 = { ...app.DB.prospects.r3, transferFrom: 'Missouri', sourceOrder: 2 };
  const html = app.renderFeed();
  assert.deepEqual(prospectIDs(html), ['r1','r2','r3']);
  assert.doesNotMatch(html, /data-open-thread=/);
  assert.match(html, /From <strong>UAB/);
  assert.match(html, /RS JR · 2 years left/);
  assert.match(html, /Start every game/);
  app.UI.prospectId = 'r1';
  const detail = app.renderProspectDetail();
  assert.match(detail, /Explain your plan\./);
  assert.doesNotMatch(detail, /rb-values-grid|rb-star/);
});

test('transfer roster metadata survives release and oversized pitches never enter offers', () => {
  const { app } = harness();
  app.DB.recruitingStage = 'transfer';
  const p = app.prospectFromRosterRow({rank: 9, name: 'John Smith', transferFrom: 'UAB', grade: 'SR', yearsLeft: 1, brokenPromise: 'Stay', prompt: 'Tell me why', sourceOrder: 3}, 'r9');
  assert.equal(p.transferFrom, 'UAB');
  assert.equal(p.grade, 'SR');
  assert.equal(p.yearsLeft, 1);
  assert.equal(p.prompt, 'Tell me why');
  assert.equal(p.stars, null);
  app.DB.prospects.r9 = p;
  app.DB.offersLocked = false;
  const result = app.addOfferDirect('r9', 'Michigan State', 'Coach', 'word '.repeat(801), [], {});
  assert.equal(result.ok, false);
  assert.match(result.error, /801 words/);
  assert.equal(app.DB.offersByProspect.r9, undefined);
});


test('transfer overrides cannot leak from a previous season with reused IDs', () => {
  const { app } = harness();
  app.DB.recruitingStage = 'transfer';
  app.DB.prospects.r1.commitTeam = 'Michigan State';
  app.DB.manualCommitOverrides = {r1:{team:'Michigan State'}};
  app.applyManualCommitOverrides();
  assert.equal(app.DB.prospects.r1.commitTeam, undefined);
  assert.equal(app.DB.manualCommitOverrides.r1, undefined);
  app.DB.manualCommitOverrides.r1 = {team:'Michigan State',name:'Jordan Able',stage:'transfer'};
  app.applyManualCommitOverrides();
  assert.equal(app.DB.prospects.r1.commitTeam,'Michigan State');
  app.clearRecruitingBoard();
  assert.equal(Object.keys(app.DB.manualCommitOverrides).length,0);
});

test('transfer display hides rank numbers and searches eligibility with grade filters', () => {
  const { app } = harness();
  app.DB.recruitingStage = 'transfer';
  Object.assign(app.DB.prospects.r1,{grade:'RS JR',yearsLeft:2,transferFrom:'South Carolina'});
  const html=app.renderFeed();
  assert.match(html,/data-transfer-filter-mode="grade"/);
  assert.match(html,/id="rb-transfer-slider"/);
  assert.doesNotMatch(html,/>#1<|placeholder="[^"]*rank/);
  app.UI.prospectId='r1';
  assert.doesNotMatch(app.renderProspectDetail(),/>#1 /);
  assert.deepEqual(prospectIDs(app.renderBoardSearchResults('rs jr')),['r1']);
  assert.deepEqual(prospectIDs(app.renderBoardSearchResults('2 years left')),['r1']);
  assert.equal(app.findProspectFromSheetRow(['1','Wrong Name'],0,1),null);
  assert.equal(app.findProspectFromSheetRow(['999','Jordan Able'],0,1).id,'r1');
  assert.match(app.transferCardStyle({transferFrom:'South Carolina',commitTeam:'Michigan State'}),/linear-gradient/);
});


test('transfer settings select players by name and apply/clear the selected commitment', async () => {
  const {app,elements} = harness();
  app.DB.recruitingStage = 'transfer';
  app.setSession({team:'Michigan State',accessLevel:'commissioner'});
  app.DB.prospects.r2.transferFrom = 'South Carolina';
  app.UI.commitOverrideRank = '2';
  const html = app.renderClassSetup();
  assert.match(html, /<select[^>]*id="rb-commit-override-rank"/);
  assert.match(html, /value="2" selected>Morgan Baker — South Carolina/);
  elements['rb-commit-override-rank'] = {...element(),value:'2'};
  elements['rb-commit-override-team'] = {...element(),value:'Michigan State'};
  app.requestManualCommitOverride();
  assert.equal(app.UI.pendingCommitOverride.name,'Morgan Baker');
  await app.applyManualCommitOverride();
  assert.equal(app.DB.prospects.r2.commitTeam,'Michigan State');
  assert.equal(app.DB.manualCommitOverrides.r2.name,'Morgan Baker');
  assert.equal(app.UI.commitOverrideRank,'');
  assert.equal(app.UI.commitOverrideTeam,'');
  app.requestClearCommit();
  assert.equal(app.UI.pendingClearCommit.name,'Morgan Baker');
  await app.clearManualCommitOverride();
  assert.equal(app.DB.prospects.r2.commitTeam,'');
  assert.equal(app.DB.manualCommitOverrides.r2,undefined);
  elements['rb-commit-override-rank'].value='';
  app.requestClearCommit();
  assert.match(app.UI.commitOverrideError,/Select the player/);
});


test('transfer sliders use fixed stops and only one eligibility filter at a time', () => {
  const {app} = harness();
  app.setTransferFilter('years',4);
  assert.equal(app.UI.transferYears,'4');
  assert.equal(app.UI.transferGrade,'');
  assert.match(app.renderTransferFilters(),/type="range" min="1" max="4"/);
  app.setTransferFilter('grade',null);
  assert.equal(app.UI.transferYears,'');
  const html = app.renderTransferFilters();
  assert.equal((html.match(/type="range"/g)||[]).length,1);
  for(const grade of ['RS FR','SO','RS SO','JR','RS JR','SR','RS SR']) assert.ok(html.includes('>'+grade+'</span>'));
  app.setTransferFilter('grade',4);
  assert.equal(app.UI.transferGrade,'RS JR');
  assert.equal(app.UI.transferYears,'');
  app.setTransferFilter('years',null);
  assert.equal(app.UI.transferGrade,'');
  assert.equal(app.UI.transferYears,'');
});


test('settings drafts make no writes and leaving can cancel or discard all changes', async () => {
  const {app,context} = harness();
  app.setSession({team:'Michigan State',accessLevel:'commissioner'});
  app.UI.view='setup';
  const original=app.DB.offersLocked;
  app.beginSettingsDraft();
  app.DB.offersLocked=!original;
  let writes=0;
  context.window.localStorage.setItem=()=>{writes++;};
  context.window.location.protocol='https:';
  context.fetch=()=>{throw Error('No requests allowed before Save');};
  await app.saveDBNow();
  await app.updateCommitsFromSheet();
  await app.runBackupNow();
  assert.equal(writes,0);
  assert.equal(app.hasSettingsChanges(),true);
  context.window.confirm=()=>false;
  assert.equal(app.canLeaveSettings('feed'),false);
  assert.equal(app.DB.offersLocked,!original);
  context.window.confirm=()=>true;
  app.UI.commitOverrideRank='1'; app.UI.commitOverrideTeam='Michigan State';
  assert.equal(app.canLeaveSettings('feed'),true);
  assert.equal(app.DB.offersLocked,original);
  assert.equal(app.UI.commitOverrideRank,'');
  assert.equal(app.UI.commitOverrideTeam,'');
  assert.equal(writes,0);
});

test('Save settings is the write boundary and keeps drafts after a server failure', async () => {
  const {app,context} = harness();
  app.setSession({team:'Michigan State',accessLevel:'commissioner'});
  app.UI.view='setup';
  app.setReady();
  app.beginSettingsDraft();
  const live=JSON.parse(JSON.stringify(app.leagueStatePayload()));
  app.DB.offersLocked=true;
  context.window.location.protocol='https:';
  let puts=0;
  context.fetch=async(url,options={})=>{
    if(options.method==='PUT') { puts++; return {ok:false,json:async()=>({error:'Test save failed'})}; }
    return {ok:true,json:async()=>({state:live})};
  };
  await app.saveSettingsChanges();
  assert.equal(puts,1);
  assert.equal(app.hasSettingsChanges(),true);
  assert.match(app.UI.settingsError,/Test save failed/);
  context.fetch=async(url,options={})=>{
    if(options.method==='PUT') { puts++; return {ok:true,json:async()=>({state:JSON.parse(options.body).state})}; }
    return {ok:true,json:async()=>({state:live})};
  };
  await app.saveSettingsChanges();
  assert.equal(puts,2);
  assert.equal(app.hasSettingsChanges(),false);
  assert.equal(app.DB.offersLocked,true);
});

test('settings merge preserves unrelated live changes and rejects conflicting edits', () => {
  const {app}=harness();
  const base={offersLocked:false,prospects:{r1:{commitTeam:''},r2:{commitTeam:''}}};
  const draft={offersLocked:true,prospects:{r1:{commitTeam:''},r2:{commitTeam:''}}};
  const live={offersLocked:false,prospects:{r1:{commitTeam:'UAB'},r2:{commitTeam:''}}};
  const result=app.mergeSettingsValue(base,draft,live);
  assert.equal(result.offersLocked,true);
  assert.equal(result.prospects.r1.commitTeam,'UAB');
  draft.prospects.r1.commitTeam='Michigan State';
  assert.throws(()=>app.mergeSettingsValue(base,draft,live),/league changed/);
});
