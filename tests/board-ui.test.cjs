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
  globalThis.app = { DB, UI, applyConditionalRescinds, readRescindRuleForm, validateRescindRuleDraft, requestQuickWalkon, renderQuickWalkonConfirm, canQuickOfferWalkon, quickOfferWalkon, renderQuickWalkon, renderProspectBoardCard, scheduleSummaryCountdown, dismissSummaryBanner, bindFloatingSubmit, extractPromises, cleanDisplayPromises, readCprBoard, updateBucksEntries, renderBucksSettings, renderCprProfile, cprPreviousSchool, ensureCprScholarshipThreads, renderAutoCommitSettings, stageAutoCommits, readScholarshipCapacity, buildPromiseArchive, parseCsvRows, offerCountForProspect, refreshScholarshipHistory, submitCprOffer, renderSubmitModal, createCprPlayer, loadClassData, resetOfferWindow, setOffersLocked, offersLocked, pendingCommitChanges, restoreSettingsDraft, renderOfferBlock, renderRescindFilterFields, renderVisitLedger, visibleBoardProspectIds, setRecruitingStage, requestReset, approveDangerReset, beginSettingsDraft, hasSettingsChanges, canLeaveSettings, saveSettingsChanges, saveDBNow, leagueStatePayload, mergeSettingsValue, updateCommitsFromSheet, runBackupNow, setTransferFilter, renderTransferFilters, renderClassSetup, requestManualCommitOverride, applyManualCommitOverride, requestClearCommit, clearManualCommitOverride, applyManualCommitOverrides, clearRecruitingBoard, findProspectFromSheetRow, transferCardStyle, parseFullClass, prospectFromRosterRow, confirmTransferImport, releaseSingleStageBoard, addOfferDirect, render, renderNav, navigateTo, applyRoute, setReady(){ dbReady = true; sessionReady = true; }, renderFeed, renderBoardSearchResults, renderTeamsPage,
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
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'cpr-rules.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'walkon-limit.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'scholarship-history.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'offer-window.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(rootDir, 'auto-commits.js'), 'utf8'), context);
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
    for (const field of ['stars', 'scholarship', 'overall-mode', 'overall-value']) {
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
  assert.match(html, /Previous team:<\/span> <strong>UAB/);
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

test('transfer search excludes eligibility while retaining grade filters', () => {
  const { app } = harness();
  app.DB.recruitingStage = 'transfer';
  Object.assign(app.DB.prospects.r1,{grade:'RS JR',yearsLeft:2,transferFrom:'South Carolina'});
  const html=app.renderFeed();
  assert.match(html,/data-transfer-filter-mode="grade"/);
  assert.match(html,/id="rb-transfer-slider"/);
  assert.doesNotMatch(html,/>#1<|placeholder="[^"]*rank/);
  app.UI.prospectId='r1';
  assert.doesNotMatch(app.renderProspectDetail(),/>#1 /);
  assert.deepEqual(prospectIDs(app.renderBoardSearchResults('rs jr')),[]);
  assert.deepEqual(prospectIDs(app.renderBoardSearchResults('2 years left')),[]);
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
  assert.match(html, /<input type="hidden" id="rb-commit-override-rank" value="2"/);
  assert.match(html, /id="rb-commit-player-search" role="combobox"/);
  assert.match(html, /id="rb-commit-player-options" role="listbox"/);
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
  for(const grade of ['FR','RS FR','SO','RS SO','JR','RS JR','SR','RS SR']) assert.ok(html.includes('>'+grade+'</span>'));
  assert.match(html,/type="range" min="0" max="7"/);
  for (const [index, grade] of ['FR','RS FR','SO','RS SO','JR','RS JR','SR','RS SR'].entries()) {
    app.setTransferFilter('grade',index);
    assert.equal(app.UI.transferGrade,grade);
  }
  app.setTransferFilter('grade',5);
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

for (const stage of ['transfer','cpr']) test(stage + ' position counts follow slider changes and restore on Show all', () => {
  const {app, context, elements, results, getCards} = harness();
  app.DB.recruitingStage = stage;
  Object.assign(app.DB.prospects.r1, {grade:'JR', yearsLeft:2});
  Object.assign(app.DB.prospects.r2, {grade:'RS SO', yearsLeft:3});
  const key = 'board:wave1';
  const chips = ['QB','WR'].map(pos => {
    const chip = element({'data-position-filter':key, 'data-position-bucket':pos});
    chip.count = {};
    chip.querySelector = () => chip.count;
    return chip;
  });
  results.innerHTML = app.renderThreadProspectList(app.DB.threads[0]);
  assert.match(results.innerHTML, /id="rb-transfer-slider"/);
  const original = context.document.querySelectorAll;
  context.document.querySelectorAll = selector => selector === '[data-position-filter]' ? chips : original(selector);
  elements['rb-board-result-count'] = element();
  elements['rb-transfer-filter-controls'] = element();
  elements['rb-transfer-slider'] = element();
  elements['rb-transfer-filter-reset'] = element();
  app.bindEvents();
  const counts = () => chips.map(chip => chip.count.textContent);
  assert.deepEqual(counts(), ['1','1']);
  assert.equal(elements['rb-board-result-count'].textContent, '2 players');
  app.setTransferFilter('grade',null);
  elements['rb-transfer-slider'].value = '4';
  elements['rb-transfer-slider'].oninput();
  assert.deepEqual(counts(), ['1','0']);
  assert.equal(elements['rb-board-result-count'].textContent, '1 player');
  elements['rb-transfer-slider'].value = '3';
  elements['rb-transfer-slider'].oninput();
  assert.deepEqual(counts(), ['0','1']);
  assert.equal(getCards()[0].style.display,'none');
  app.setTransferFilter('years',null);
  elements['rb-transfer-slider'].value = '4';
  elements['rb-transfer-slider'].oninput();
  assert.deepEqual(counts(), ['0','0']);
  assert.equal(elements['rb-board-result-count'].textContent, '0 players');
  elements['rb-transfer-filter-reset'].onclick();
  assert.deepEqual(counts(), ['1','1']);
  assert.equal(elements['rb-board-result-count'].textContent, '2 players');
});

 test('two distinct commissioners must approve resets and stage switches; coaches cannot', async () => {
  const {app} = harness();
  app.setRecruitingStage('transfer');
  assert.ok(!app.UI.confirmReset);
  app.setSession({accessLevel:'commissioner',discordId:'test'});
  app.beginSettingsDraft();
  app.setRecruitingStage('transfer');
  assert.equal(app.UI.confirmReset,'stage:transfer');
  await app.approveDangerReset();
  assert.equal(app.DB.recruitingStage,'hs');
  await app.approveDangerReset();
  assert.equal(app.DB.recruitingStage,'hs');
  app.setSession({accessLevel:'commissioner',discordId:'second'});
  await app.approveDangerReset();
  assert.equal(app.DB.recruitingStage,'transfer');
  assert.equal(Object.keys(app.DB.prospects).length,0);
  assert.equal(app.hasSettingsChanges(),true);
  app.DB.offersByProspect = {r1:[{team:'Test'}]};
  app.requestReset('offers');
  await app.approveDangerReset();
  assert.equal(Object.keys(app.DB.offersByProspect).length,1);
  app.setSession({accessLevel:'commissioner',discordId:'test'});
  await app.approveDangerReset();
  assert.equal(Object.keys(app.DB.offersByProspect).length,0);
});

test('only high school settings expose commit sheets; all stages retain manual overrides', () => {
  for (const stage of ['hs','transfer','cpr']) {
    const {app} = harness();
    app.setSession({accessLevel:'commissioner'});
    app.DB.recruitingStage = stage;
    app.DB.commitSheetUrl = '';
    const html = app.renderClassSetup();
    assert.equal(html.includes('id="rb-commit-sheet-url"'),stage === 'hs');
    assert.ok(html.includes('id="rb-apply-commit-override"'));
    assert.equal(html.includes('id="rb-update-commits"'),stage === 'hs');
    assert.ok(!html.includes('or published CSV URL'));
  }
});

test('stage controls and public offer filtering match each recruiting stage', () => {
  for (const stage of ['hs','transfer','cpr']) {
    const {app} = harness();
    app.DB.recruitingStage = stage;
    const fields = app.renderRescindFilterFields('test',true);
    assert.equal(fields.includes('test-stars'),stage === 'hs');
    assert.equal(fields.includes('test-rank-value'),false);
    assert.equal(app.renderVisitLedger() === '',stage !== 'hs');
    app.DB.offersByProspect = {r1:[{team:'Michigan State'}],r2:[{team:'Michigan State',rescinded:true},{team:'Alabama'}]};
    app.UI.boardOfferFilter = 'offered';
    assert.deepEqual(Array.from(app.visibleBoardProspectIds(app.DB.threads[0])),['r1','r2']);
    app.UI.boardOfferFilter = 'unoffered';
    assert.deepEqual(Array.from(app.visibleBoardProspectIds(app.DB.threads[0])),[]);
    app.UI.boardCommitFilter = 'committed';
    assert.equal(app.visibleBoardProspectIds(app.DB.threads[0]).length,0);
  }
});

test('public transfer offer counts exclude headers and update with pitch text', () => {
  const {app} = harness();
  app.DB.recruitingStage = 'transfer';
  const prospect = {name:'Bob Jones'};
  const offer = {team:'Michigan State',text:'Michigan State offers Bob Jones\nScholarship\nHello Bob'};
  for (const opts of [{collapsed:true},{expanded:true},{hideHeader:true}]) {
    assert.match(app.renderOfferBlock(offer,{...opts,prospect}),/2 \/ 800 words/);
  }
  offer.text += ' welcome';
  assert.match(app.renderOfferBlock(offer,{prospect}),/3 \/ 800 words/);
  offer.rescinded = true;
  assert.doesNotMatch(app.renderOfferBlock(offer,{prospect}),/800 words/);
  offer.rescinded = false;
  app.DB.recruitingStage = 'hs';
  assert.doesNotMatch(app.renderOfferBlock(offer,{prospect}),/800 words/);
});

test('settings save enables for drafts and discard restores the saved settings', () => {
  const {app,elements} = harness();
  app.setSession({accessLevel:'commissioner'});
  app.UI.view = 'setup';
  let html = app.renderClassSetup();
  assert.match(html,/id="rb-save-settings" disabled/);
  assert.match(html,/id="rb-discard-settings" hidden/);
  const original = app.DB.offersLocked;
  app.DB.offersLocked = !original;
  html = app.renderClassSetup();
  assert.doesNotMatch(html,/id="rb-save-settings" disabled/);
  assert.doesNotMatch(html,/id="rb-discard-settings" hidden/);
  elements['rb-discard-settings'] = element();
  app.bindEvents();
  elements['rb-discard-settings'].onclick();
  assert.equal(app.DB.offersLocked,original);
  assert.match(app.renderClassSetup(),/id="rb-save-settings" disabled/);
});

test('pending commitments list all unsaved players and reflect subsequent corrections', () => {
  const {app} = harness();
  app.setSession({accessLevel:'commissioner'});
  app.beginSettingsDraft();
  app.DB.prospects.r1.commitTeam = 'Army';
  app.DB.prospects.r2.commitTeam = 'Alabama';
  assert.deepEqual(Array.from(app.pendingCommitChanges()),['Jordan Able will commit to Army.','Morgan Baker will commit to Alabama.']);
  app.DB.prospects.r1.commitTeam = '';
  assert.deepEqual(Array.from(app.pendingCommitChanges()),['Commitment will be cleared for Jordan Able.','Morgan Baker will commit to Alabama.']);
  app.restoreSettingsDraft();
  assert.equal(app.pendingCommitChanges().length,0);
});

test('new class resets offer window and schedule edits stay in settings draft', () => {
  const {app} = harness();
  for (const stage of ['hs','transfer','cpr']) {
    app.DB.recruitingStage = stage;
    app.DB.offersLocked = false;
    app.DB.offerSchedule = {opensAt:'2020-01-01T00:00:00Z'};
    app.clearRecruitingBoard();
    assert.equal(app.offersLocked(),true);
    assert.equal(app.DB.offerSchedule,null);
  }
  app.setSession({accessLevel:'commissioner'});
  app.beginSettingsDraft();
  app.DB.offerSchedule={timezone:'America/Chicago',opensAt:'2026-12-01T16:00:00Z'};
  assert.equal(app.hasSettingsChanges(),true);
  app.restoreSettingsDraft();
  assert.equal(app.DB.offerSchedule,null);
});

test('manual commit picker filters names and selects with Enter', () => {
  const {app,elements} = harness();
  const search=elements['rb-commit-player-search']=element();
  search.removeAttribute=()=>{};
  const options=elements['rb-commit-player-options']=element();
  options.querySelectorAll=()=>[];
  const rank=elements['rb-commit-override-rank']=element();
  app.bindEvents();
  search.value='morgan';
  search.oninput();
  assert.match(options.innerHTML,/Morgan Baker/);
  assert.ok(!options.innerHTML.includes('Jordan Able'));
  assert.equal(rank.value,'');
  search.onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(search.value,'Morgan Baker');
  assert.equal(rank.value,String(app.DB.prospects.r2.rank));
  assert.equal(options.hidden,true);
  search.value='no such player';
  search.oninput();
  assert.match(options.innerHTML,/No matching players/);
  assert.equal(rank.value,'');
});

test('manual commit team picker filters beneath its input and selects with Enter', () => {
  const {app,elements} = harness();
  const search=elements['rb-commit-override-team']=element();
  search.removeAttribute=()=>{};
  const options=elements['rb-commit-team-options']=element();
  options.querySelectorAll=()=>[];
  app.bindEvents();
  search.value='michigan state';
  search.oninput();
  assert.match(options.innerHTML,/Michigan State/);
  assert.ok(!options.innerHTML.includes('Alabama'));
  search.onkeydown({key:'Enter',preventDefault(){}});
  assert.equal(search.value,'Michigan State');
  assert.equal(app.UI.commitOverrideTeam,'Michigan State');
  assert.equal(options.hidden,true);
});

test('scheduled close uses Eastern end-of-day with manual opening', () => {
  const {app,elements} = harness();
  app.setSession({accessLevel:'commissioner'});
  const html = app.renderClassSetup();
  assert.ok(!html.includes('datetime-local'));
  assert.ok(!html.includes('id="rb-schedule-zone"'));
  for (const key of ['closesAt']) for (const part of ['month','day','year','clear']) elements['rb-schedule-' + key + '-' + part] = element();
  elements['rb-schedule-error'] = element();
  app.bindEvents();
  assert.ok(!html.includes('type="date"'));
  for (const key of ['closesAt']) {
    elements['rb-schedule-' + key + '-month'].value = '09';
    elements['rb-schedule-' + key + '-day'].value = '20';
    elements['rb-schedule-' + key + '-year'].value = '2026';
  }
  elements['rb-schedule-closesAt-month'].onchange();
  assert.ok(!html.includes('Scheduled open'));
  assert.equal(app.DB.offerSchedule.opensAt,undefined);
  assert.equal(app.DB.offerSchedule.closesAt,'2026-09-21T03:59:59.000Z');
  assert.equal(app.DB.offerSchedule.timezone,'America/New_York');
});

test('manual opening preserves a future close and clears an expired close', () => {
  const {app} = harness();
  app.DB.offerSchedule={opensAt:'2020-01-01T00:00:00Z',closesAt:'2099-09-21T03:59:59Z'};
  app.setOffersLocked(false);
  assert.equal(app.offersLocked(),false);
  assert.equal(app.DB.offerSchedule.closesAt,'2099-09-21T03:59:59Z');
  assert.equal(app.DB.offerSchedule.opensAt,undefined);
  app.DB.offerSchedule.closesAt='2020-01-01T00:00:00Z';
  app.setOffersLocked(false);
  assert.equal(app.DB.offerSchedule,null);
  assert.equal(app.offersLocked(),false);
});

test('My Offers expands directly to full pitches without a second disclosure or scroll box', () => {
  const {app} = harness();
  app.DB.offersByProspect = {r1:[{id:'offer1',team:'Michigan State',text:'Full pitch for Jordan Able',visits:{}}]};
  for (const committed of [true,false]) {
    app.DB.prospects.r1.commitTeam = committed ? 'Michigan State' : '';
    const html = app.renderMyOffers();
    assert.ok(html.includes('Full pitch for Jordan Able'));
    assert.ok(!html.includes('data-offer-details="1"'));
    assert.ok(!html.includes('max-height:140px;overflow:auto;'));
  }
});

test('CPR CSV creates qualifying player threads and validates below-threshold additions', () => {
  const {app} = harness();
  app.DB.recruitingStage='cpr';
  app.clearRecruitingBoard();
  const csv='Name,Pos,Team,Ovr,Pot\nHigh Safety,S,FA,40,60\nPitch Safety,S,FA,40,70\nLow Safety,S,FA,29,55\nTop QB,QB,FA,36,60\nNot Free,QB,Alabama,99,99';
  app.loadClassData(csv);
  assert.equal(app.DB.fullRoster.length,4);
  assert.equal(app.DB.fullRoster.filter(p=>p.offerMode==='pitch').length,2);
  assert.equal(app.DB.fullRoster.find(p=>p.name==='Pitch Safety').offerMode,'pitch');
  assert.equal(app.DB.fullRoster[0].legacySchool,'');
  assert.equal(app.DB.fullRoster[0].storyline,'');
  app.releaseSingleStageBoard();
  assert.equal(Object.keys(app.DB.prospects).length,3);
  assert.equal(app.DB.threads.length,3);
  assert.equal(app.DB.offersLocked,true);
  const id=app.createCprPlayer({name:'Low Safety',position:'S',overall:'29',potential:'55'});
  assert.equal(app.DB.prospects[id].name,'Low Safety');
  assert.equal(app.DB.prospects[id].stars,null);
  app.createCprPlayer({name:'Low Safety',position:'S',overall:'29',potential:'55'});
  assert.equal(app.DB.threads.length,4);
  assert.throws(()=>app.createCprPlayer({name:'Low Safety',position:'S',overall:'30',potential:'55'}),/No free agent/);
  const html=app.renderFeed();
  assert.ok(!html.includes('Not provided'));
  assert.ok(html.includes('PITCH RECRUIT'));
  assert.ok(!html.includes('Coach-created'));
  assert.ok(!html.includes('Previous team:'));
  assert.ok(!html.includes('Years left:'));
  assert.ok(!html.includes('Pitch prompt'));
});

test('CPR sample CSV yields expected automatic threads when supplied for local validation', {skip:!process.env.CPR_SAMPLE_CSV}, () => {
  const {app}=harness();
  app.DB.recruitingStage='cpr'; app.clearRecruitingBoard();
  app.loadClassData(fs.readFileSync(process.env.CPR_SAMPLE_CSV,'utf8'));
  assert.equal(app.DB.fullRoster.length,2427);
  assert.equal(app.DB.fullRoster.filter(p=>p.offerMode==='pitch').length,11);
  app.releaseSingleStageBoard();
  assert.equal(Object.keys(app.DB.prospects).length,54);
  assert.equal(app.DB.threads.length,54);
});

test('CPR PlayerBios Country is home state and jersey numbers never become player IDs', () => {
  const {app}=harness();
  const rows=app.parseFullClass('Name,Pos,#,Team,Country,Ovr,Pot\nOne,QB,-Infinity,FA,Ohio,40,60\nTwo,QB,18,FA,Texas,35,60\nThree,S,18,FA,Florida,29,50',{stage:'cpr'});
  assert.deepEqual(Array.from(rows,p=>p.rank),[1,2,3]);
  assert.equal(rows[0].homestate,'Ohio');
  assert.equal(rows[0].hometown,'Ohio');
  assert.equal(rows[0].previousTeam,'');
  assert.equal(rows[0].yearsLeft,'');
});

test('CPR offer submission creates its CSV thread and offer together, then routes repeats', async () => {
  const {app,elements}=harness();
  app.DB.recruitingStage='cpr'; app.clearRecruitingBoard();
  app.loadClassData('Name,Pos,Team,Ovr,Pot\nTop S,S,FA,40,60\nLow S,S,FA,29,45');
  app.releaseSingleStageBoard(); app.DB.offersLocked=false;
  elements['rb-submit-error']=element();
  await app.submitCprOffer('Michigan State offers Low S (S)\nScholarship\nWelcome to our team.');
  assert.equal(app.DB.prospects.r2.name,'Low S');
  assert.equal(app.DB.prospects.r2.coachCreated,true);
  assert.equal(app.DB.offersByProspect.r2.length,1);
  assert.equal(app.DB.threads.length,2);
  await app.submitCprOffer('Michigan State offers Low S (S)\nScholarship\nSecond offer.');
  assert.equal(app.DB.offersByProspect.r2.length,1);
  assert.equal(app.DB.threads.length,2);
  assert.match(elements['rb-submit-error'].textContent,/already offered/);
  await app.submitCprOffer('Michigan State offers Nonexistent Person');
  assert.equal(app.DB.threads.length,2);
  assert.match(elements['rb-submit-error'].textContent,/No matching/);
  const html=app.renderSubmitModal();
  assert.ok(html.includes('existing thread or create one'));
  assert.ok(!html.includes('detect visits'));
});

test('CPR player detail displays home state once',()=>{
  const {app}=harness();
  app.DB.recruitingStage='cpr';
  Object.assign(app.DB.prospects.r1,{hometown:'Pennsylvania',homestate:'Pennsylvania'});
  app.UI.prospectId='r1';
  assert.equal((app.renderProspectDetail().match(/Pennsylvania/g)||[]).length,1);
});

test('scholarship import stages changes by player ID, rejects wrong seasons, and discards cleanly',async()=>{
 const {app,context,elements}=harness();
 app.DB.recruitingStage='cpr';
 app.setSession({accessLevel:'commissioner',discordId:'test'});
 app.DB.fullRoster=[{rank:1,name:'Jordan Able',exportPlayerId:123,metadataSeason:2064,overall:20,position:'QB'}];
 app.beginSettingsDraft();
 elements['rb-scholarship-source']=element();
 elements['rb-scholarship-source'].value='https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrst/edit';
 let season=2063;
 context.fetch=async(url)=>{
   assert.match(url,/^\/api\/admin\/scholarship-history/);
   return {ok:true,json:async()=>({ok:true,season,source:'test',players:[{id:'123',name:'Jordan Able',everScholarship:true}]})};
 };
 await app.refreshScholarshipHistory();
 assert.match(app.UI.scholarshipStatus,/does not match/);
 assert.equal(app.hasSettingsChanges(),false);
 season=2064;
 await app.refreshScholarshipHistory();
 assert.equal(app.DB.prospects.r1.everScholarship,true);
 assert.equal(app.hasSettingsChanges(),true);
 assert.equal(app.prospectFromRosterRow(app.DB.fullRoster[0],'r1').everScholarship,true);
 app.restoreSettingsDraft();
 assert.equal(app.DB.prospects.r1.everScholarship,undefined);
 assert.equal(app.DB.scholarshipHistory,undefined);
});

test('offer counts exclude rescinded offers',()=>{
 const {app}=harness();
 app.DB.offersByProspect.r1=[{team:'Michigan State'},{team:'Alabama',rescinded:true},{team:'Stanford'}];
 assert.equal(app.offerCountForProspect('r1'),2);
 assert.equal(app.offerCountForProspect('missing'),0);
});

test('rescinded offer retains its text and header status',()=>{
 const {app}=harness();
 const html=app.renderOfferBlock({team:'Stanford',text:'The original offer stays readable.',rescinded:true,promises:[],visits:{}},{fullText:true});
 assert.match(html,/The original offer stays readable/);
 assert.match(html,/rb-offer-rescinded/);
 assert.match(html,/rb-offer-team-title[\s\S]*?rb-rescinded-badge/);
 assert.equal((html.match(/>Rescinded</g)||[]).length,1);
});

test('promise CSV contains only winner names, teams, and three escaped promises',()=>{
 const {app}=harness();
 app.DB.prospects.r1.name='Jordan "Jay", Able';
 app.DB.offersByProspect.r1=[{team:'Alabama',text:'',promises:[{text:'I promise weekly film sessions.'}]},{team:'Boise State',rescinded:true,text:'',promises:[{text:'I promise a starting role.'}]},{team:'Boise State',text:'',promises:[{text:'I promise a role in the rotation.'},{text:'I promise weekly film sessions.'}]}];
 const rows=app.parseCsvRows(app.buildPromiseArchive());
 assert.equal(rows.length,2);
 assert.equal(rows[0].join('|'),'Name|Committed Team|Promise 1|Promise 2|Promise 3');
 assert.equal(rows[1][0],'Jordan "Jay", Able');
 assert.equal(rows[1][1],'Boise State');
 assert.equal(rows[1][2],'I promise a role in the rotation.');
 assert.equal(rows[1][3],'I promise weekly film sessions.');
 assert.equal(rows[1][4],'');
});

test('auto settings preview, staged commitments, and discard use the settings draft',()=>{
 const {app}=harness();app.setSession({accessLevel:'commissioner'});
 app.DB.recruitingStage='cpr';app.DB.offersLocked=true;
 app.DB.prospects={r2:{id:'r2',rank:2,name:'Morgan Baker',position:'WR',rating:'54/68',overall:54,potential:68}};
 app.DB.offersByProspect={r2:[{id:'o1',team:'Michigan State',text:'Scholarship'}]};
 app.DB.scholarshipCapacity={stage:'cpr',updatedAt:Date.now(),teams:{'michigan state':{team:'Michigan State',open:1}}};
 app.UI.autoCategory='scholarship';app.beginSettingsDraft();
 assert.match(app.renderAutoCommitSettings(),/1 uncommitted scholarship auto/);
 assert.equal(app.DB.prospects.r2.commitTeam,undefined);
 app.stageAutoCommits();assert.equal(app.DB.prospects.r2.commitTeam,'Michigan State');
 assert.equal(app.hasSettingsChanges(),true);
 assert.match(app.renderAutoCommitSettings(),/No uncommitted scholarship autos/);
 app.restoreSettingsDraft();assert.equal(app.DB.prospects.r2.commitTeam,undefined);
 assert.equal(app.DB.manualCommitOverrides.r2,undefined);
});

test('scholarship starting balances are captured and cannot refresh after commitments',async()=>{
 const {app,context,elements}=harness();app.setSession({accessLevel:'commissioner'});app.DB.recruitingStage='cpr';app.DB.prospects={};app.beginSettingsDraft();
 elements['rb-capacity-source']={value:'https://docs.google.com/spreadsheets/d/11-87AU--uFWHfHCB3S2IbkVOrSNP2X3x1j_M5s1dFys/edit?gid=1039825625'};
 let reads=0;context.fetch=async()=>{reads++;return {ok:true,json:async()=>({ok:true,teams:{'michigan state':{team:'Michigan State',open:2}},source:'https://docs.google.com/spreadsheets/d/source'})};};
 await app.readScholarshipCapacity();assert.equal(app.DB.scholarshipCapacity.teams['michigan state'].open,2);assert.equal(app.DB.scholarshipCapacity.stage,'cpr');
 app.DB.prospects.r1={id:'r1',name:'Committed',position:'QB',overall:50,commitTeam:'Michigan State'};
 await app.readScholarshipCapacity();assert.equal(reads,1);assert.match(app.UI.capacityStatus,/cannot be refreshed/);
 app.restoreSettingsDraft();assert.equal(app.DB.scholarshipCapacity,undefined);
});

test('new class clears starting balances but retains manually tracked yearly Bucks allowances',()=>{
 const {app}=harness();app.DB.scholarshipCapacity={stage:'cpr',teams:{}};app.DB.bucksRemaining={alabama:1};app.clearRecruitingBoard();
 assert.equal(app.DB.scholarshipCapacity,null);assert.equal(app.DB.bucksRemaining.alabama,1);
});

test('below-threshold scholarship players gain threads after scholarship import without duplicates',()=>{
 const {app}=harness();app.DB.recruitingStage='cpr';app.DB.wave1Released=true;app.DB.prospects={};app.DB.threads=[];app.DB.released={};
 app.DB.fullRoster=[{rank:1,name:'John Marks',position:'QB',overall:26,potential:44,rating:'26/44',everScholarship:true},{rank:2,name:'Piotr Lewandowski',position:'RB',overall:33,potential:52,rating:'33/52',everScholarship:true},{rank:3,name:'Joe Jack-Kurdyla',position:'WR',overall:30,potential:46,rating:'30/46',everScholarship:true},{rank:4,name:'Joey Bosa Jr.',position:'DL',overall:31,potential:56,rating:'31/56',everScholarship:true},{rank:5,name:'Walk-on below cutoff',position:'QB',overall:26,potential:44}];
 assert.equal(app.ensureCprScholarshipThreads(),4);assert.equal(Object.keys(app.DB.prospects).length,4);assert.equal(app.DB.threads.length,4);
 assert.equal(app.ensureCprScholarshipThreads(),0);assert.equal(app.DB.threads.length,4);
 assert.equal(app.DB.prospects.r1.everScholarship,true);assert.equal(app.DB.prospects.r5,undefined);
});

test('auto batches refuse stale live offers and preserve the draft',async()=>{
 const {app,context}=harness();app.setSession({accessLevel:'commissioner'});app.DB.recruitingStage='cpr';app.DB.offersLocked=true;
 app.DB.prospects={r2:{id:'r2',rank:2,name:'Morgan Baker',position:'WR',rating:'54/68',overall:54,potential:68}};
 app.DB.offersByProspect={r2:[{id:'o1',team:'Michigan State',text:'Scholarship'}]};app.DB.scholarshipCapacity={stage:'cpr',teams:{'michigan state':{team:'Michigan State',open:1}}};
 app.beginSettingsDraft();const live=JSON.parse(JSON.stringify(app.leagueStatePayload()));app.UI.autoCategory='scholarship';app.stageAutoCommits();
 live.offersByProspect.r2.push({id:'o2',team:'Alabama',text:'Scholarship'});context.window.location.protocol='https:';let puts=0;
 context.fetch=async(url,options={})=>{if(options.method==='PUT')puts++;return {ok:true,json:async()=>({state:live})};};
 await app.saveSettingsChanges();assert.equal(puts,0);assert.match(app.UI.settingsError,/changed after this auto preview/);assert.equal(app.hasSettingsChanges(),true);
});


test('bulk Bucks entries update only named exceptions and validate the whole batch',()=>{
 const {app}=harness();app.DB.bucksRemaining={stanford:2};
 assert.equal(app.updateBucksEntries('Michigan State, 1, Alabama, 3'),2);
 assert.equal(app.DB.bucksRemaining['michigan state'],2);assert.equal(app.DB.bucksRemaining.alabama,0);assert.equal(app.DB.bucksRemaining.stanford,2);
 const before=JSON.stringify(app.DB.bucksRemaining);
 assert.throws(()=>app.updateBucksEntries('Alabama, 2\nUnknown College, 1'),/Unknown team/);assert.equal(JSON.stringify(app.DB.bucksRemaining),before);
 assert.throws(()=>app.updateBucksEntries('Alabama, 4'),/0–3/);
 assert.throws(()=>app.updateBucksEntries('Alabama, 1, Alabama, 2'),/Conflicting/);
 app.updateBucksEntries('Michigan State\t2\nAlabama\t0');assert.equal(app.DB.bucksRemaining['michigan state'],1);assert.equal(app.DB.bucksRemaining.alabama,undefined);
 const html=app.renderBucksSettings();assert.match(html,/Michigan State/);assert.match(html,/Stanford/);assert.ok(!html.includes('Air Force'));assert.ok(!html.includes('data-bucks-used="alabama"'));
});

test('only CPR true freshmen with four years left show High School with the league logo',()=>{
 const {app}=harness();app.DB.recruitingStage='cpr';
 const freshman={grade:'FR',yearsLeft:4,previousTeam:'Alabama'};
 assert.equal(app.cprPreviousSchool(freshman),'High School');
 const html=app.renderCprProfile(freshman);assert.match(html,/>High School</);assert.match(html,/nzcfl-free-agent.png/);assert.ok(!html.includes('Alabama'));
 assert.equal(app.cprPreviousSchool({...freshman,grade:'RS FR'}),'Alabama');
 assert.equal(app.cprPreviousSchool({...freshman,grade:'RSFR',previousTeam:''}),'');
 assert.equal(app.cprPreviousSchool({...freshman,yearsLeft:3}),'Alabama');
 app.DB.recruitingStage='transfer';assert.equal(app.cprPreviousSchool(freshman),'Alabama');
});


test('moderators can use routine Settings but cannot switch stages or approve resets',async()=>{
 const {app}=harness();app.setSession({team:'Michigan State',accessLevel:'moderator',discordId:'mod'});app.DB.recruitingStage='cpr';
 const html=app.renderClassSetup();
 for(const id of ['rb-offers-lock-toggle','rb-schedule-closesAt-month','rb-apply-commit-override','rb-clear-commit-override','rb-bucks-update','rb-export-promise-archive','rb-capacity-read','rb-scholarship-refresh','rb-branding-file','rb-save-settings']) assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(!html.includes('data-reset-request='));assert.match(html,/data-recruiting-stage="hs" disabled/);
 app.setRecruitingStage('transfer');assert.equal(app.DB.recruitingStage,'cpr');
 app.requestReset('offers');app.DB.offersByProspect={r1:[{id:'existing'}]};await app.approveDangerReset();assert.equal(app.DB.offersByProspect.r1.length,1);
 app.updateBucksEntries('Alabama, 2');assert.equal(app.DB.bucksRemaining.alabama,1);assert.equal(app.hasSettingsChanges(),true);
 assert.match(html,/<details class="rb-bucks-settings rb-card">/);assert.ok(!html.includes('<details class="rb-bucks-settings rb-card" open'));
});


test('team save notice clears on navigation and does not return with browser history', () => {
  const { app } = harness();
  app.UI.view = 'teams';
  app.UI.adminActionStatus = 'Team changes saved.';
  app.navigateTo('myoffers');
  assert.equal(app.UI.adminActionStatus, null);
  app.applyRoute({ view: 'teams' });
  assert.equal(app.UI.adminActionStatus, null);
  app.UI.adminActionStatus = 'Team changes saved.';
  app.applyRoute({ view: 'feed' });
  assert.equal(app.UI.adminActionStatus, null);
});


test('starred promises override casual promise wording in the same paragraph, including stored offers', () => {
  const {app}=harness();
  const text='Playing Time: Here at LSU, we promise you that you will have a lot of playing time. Our position needs work. *I promise you will start right away*';
  const promises=app.extractPromises(text);
  assert.equal(promises.length,1);
  assert.equal(promises[0].text,'I promise you will start right away');
  assert.equal(app.cleanDisplayPromises({text,promises:[{text:'we promise you that you will have a lot of playing time.'}]}).length,1);
  assert.equal(app.cleanDisplayPromises({text,promises:[]})[0].text,promises[0].text);
  assert.equal(app.extractPromises(text+'\n\nI promise we will keep our coach.').length,2);
});

test('CPR board reads recover from temporary HTML responses without writing', async () => {
  const {app,context}=harness();
  context.setTimeout=fn=>{fn();return 0;};
  let requests=0;
  context.fetch=async (url,options)=>{
    assert.equal(options.method,undefined);
    requests++;
    if(requests===1)return {ok:true,json:async()=>{throw Error('Unexpected token <');}};
    return {ok:true,json:async()=>({state:{recruitingStage:'cpr'}})};
  };
  assert.equal((await app.readCprBoard()).state.recruitingStage,'cpr');
  assert.equal(requests,2);
});


test('floating submit appears only after the original passes above the viewport and reuses its action', () => {
  const {app,context,elements}=harness();
  let callback, disconnected=false, opened=0;
  context.window.IntersectionObserver=class {
    constructor(fn){callback=fn;}
    observe(){}
    disconnect(){disconnected=true;}
  };
  const original=elements['rb-open-submit']=element();
  original.getBoundingClientRect=()=>({bottom:100});
  original.onclick=()=>opened++;
  const floating=elements['rb-floating-submit']=element();
  const button=elements['rb-floating-submit-button']=element();
  app.bindFloatingSubmit();
  assert.equal(floating.hidden,true);
  callback([{target:original,boundingClientRect:{bottom:-1}}]);
  assert.equal(floating.hidden,false);
  button.onclick();
  assert.equal(opened,1);
  callback([{target:original,boundingClientRect:{bottom:20}}]);
  assert.equal(floating.hidden,true);
  delete elements['rb-floating-submit'];
  app.bindFloatingSubmit();
  assert.equal(disconnected,true);
});


test('offer confirmation countdown and dismissal preserve the open submission form', () => {
  const {app,context,elements}=harness();
  const input=elements['rb-sheet-text']=element();
  input.value='My next offer draft';
  const name=elements['rb-cpr-offer-name']=element(); name.value='Derrick Miller';
  const position=elements['rb-cpr-offer-position']=element(); position.value='WR';
  elements['rb-summary-text']=element();
  let removed=false, tick;
  elements['rb-summary-banner']={remove(){removed=true;}};
  context.setTimeout=fn=>{tick=fn;return 1;};
  Object.defineProperty(elements['rb-app'],'innerHTML',{set(){throw Error('Countdown must not redraw the page');}});
  app.UI.showSubmitModal=true;
  app.UI.lastSummary={matched:1,dismissAt:Date.now()+6000};
  app.scheduleSummaryCountdown();
  tick();
  assert.match(elements['rb-summary-text'].textContent,/Offer submitted/);
  app.UI.lastSummary.dismissAt=Date.now()-1;
  tick();
  assert.equal(removed,true);
  assert.equal(app.UI.lastSummary,null);
  assert.equal(input.value,'My next offer draft');
  assert.equal(name.value,'Derrick Miller');
  assert.equal(position.value,'WR');
  assert.equal(app.UI.showSubmitModal,true);
  app.UI.lastSummary={matched:1};
  app.dismissSummaryBanner();
  assert.equal(input.value,'My next offer draft');
});


test('quick walk-on offers use the exact format and only existing eligible CPR threads', async () => {
  const {app}=harness();
  app.DB.recruitingStage='cpr'; app.clearRecruitingBoard();
  app.loadClassData('Name,Pos,Team,Ovr,Pot\nTop K,K,FA,70,75\nK. J. Thompson,K,FA,60,65');
  app.releaseSingleStageBoard(); app.DB.offersLocked=false;
  const p=app.DB.prospects.r2;
  assert.equal(app.canQuickOfferWalkon(p),true);
  assert.match(app.renderProspectBoardCard('r2'),/data-quick-walkon="r2"/);
  app.UI.prospectId='r2';
  assert.match(app.renderProspectDetail(),/data-quick-walkon="r2"/);
  assert.equal(app.renderQuickWalkon(app.DB.prospects.r1),'');
  app.DB.offersByProspect.r2=[{team:'Alabama',offerType:'scholarship'}];
  assert.equal(app.canQuickOfferWalkon(p),false);
  app.DB.offersByProspect.r2=[];
  p.commitTeam='Alabama'; assert.equal(app.canQuickOfferWalkon(p),false); p.commitTeam='';
  app.requestQuickWalkon('r2');
  assert.equal(app.UI.pendingQuickWalkon,'r2');
  assert.equal(app.DB.offersByProspect.r2.length,0);
  assert.match(app.renderQuickWalkonConfirm(),/Submit walk-on offer\?/);
  assert.match(app.renderQuickWalkonConfirm(),/Michigan State offers K K. J. Thompson/);
  app.UI.pendingQuickWalkon=null;
  await app.quickOfferWalkon('r2');
  assert.equal(app.DB.offersByProspect.r2.length,1);
  assert.equal(app.DB.offersByProspect.r2[0].text,'Michigan State offers K K. J. Thompson\n\nWalk-On');
  assert.equal(app.canQuickOfferWalkon(p),false);
  await app.quickOfferWalkon('r2');
  assert.equal(app.DB.offersByProspect.r2.length,1);
  assert.equal(app.DB.threads.length,2);
});


test('relative overall rules save without a number and use lowest commit in the browser', () => {
 const {app,elements}=harness();
 app.DB.recruitingStage='cpr';
 elements['rb-cond-overall-mode']={value:'atMostCommit'};
 elements['rb-cond-count']={value:'2'};
 const draft=app.readRescindRuleForm('rb-cond',true);
 assert.equal(draft.overallMode,'atMostCommit');
 assert.equal(draft.overallValue,'');
 assert.equal(app.validateRescindRuleDraft(draft), '');
 assert.match(app.renderRescindFilterFields('rb-cond',true),/belowCommit/);
 assert.doesNotMatch(app.renderRescindFilterFields('rb-mass',false),/belowCommit/);
 app.DB.prospects={};app.DB.offersByProspect={};
 for(const [id,ovr,committed] of [['a',60,true],['b',55,true],['c',54,false],['d',55,false],['e',56,false]]){
  app.DB.prospects[id]={id,name:id,position:'P',rating:ovr+'/75',commitTeam:committed?'Michigan State':''};
  app.DB.offersByProspect[id]=[{id,team:'Michigan State',text:'Scholarship'}];
 }
 app.DB.conditionalRescinds=[{...draft,enabled:true,team:'Michigan State',positions:['P']}];
 app.applyConditionalRescinds();
 assert.equal(app.DB.offersByProspect.c[0].rescinded,true);
 assert.equal(app.DB.offersByProspect.d[0].rescinded,true);
 assert.equal(!!app.DB.offersByProspect.e[0].rescinded,false);
});
