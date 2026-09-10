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
  globalThis.app = { DB, UI, renderFeed, renderBoardSearchResults, renderTeamsPage,
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
  assert.match(html, /QB<span class="rb-desktop-only"> &middot; 91/);
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
