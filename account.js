// Account layer for custody-calendar.com: sign in by email link, a calendar shared by two parents, proposals that
// the other parent approves, the record, and a private calendar feed. Talks to PocketBase on the same host
// (/api/...). The page (index.html) owns STATE and rendering; this file owns ACC and the Account place.
// Rules of the shared calendar:
//   - The approved settings (ACC.approved) are what both parents see. Edits on this device are a draft until sent.
//   - While only one parent is in the family, a sent change applies at once and is marked "not yet confirmed".
//   - The joining parent confirms the schedule as it stands; it stays in force before and after.
const ACC = (() => {
  const KEY = 'cc_acct', APPROVED_KEY = 'cc_approved', PENDING_KEY = 'cc_otp';
  const A = { auth: null, me: null, approved: null, view: 'signin', pending: null, msg: '', err: '', busy: false, propDays: new Set(), propEx: [], declineFor: null, counterOf: null, es: null, loadTimer: null, ready: false };
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const clone = (x) => JSON.parse(JSON.stringify(x));

  async function api(method, path, body) {
    const h = { 'Content-Type': 'application/json' }; if (A.auth) h.Authorization = A.auth.token;
    const r = await fetch(path, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) });
    let d = null; try { d = await r.json(); } catch (e) {}
    if (r.status === 401 && A.auth) { signOutLocal(); throw new Error('Your sign-in ended. Sign in again.'); }
    if (r.status === 429) throw new Error('Too many tries in a short time. Wait a minute and try again.');
    if (!r.ok) throw new Error((d && d.message) || `The server answered ${r.status}.`);
    return d;
  }

  // ---------- sign in ----------
  async function requestLink(email) {
    email = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    await api('POST', '/api/cc/signin', { email });
    const o = await api('POST', '/api/collections/users/request-otp', { email });
    A.pending = { email, otpId: o.otpId, at: Date.now() }; try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(A.pending)); } catch (e) {}
    A.view = 'code'; A.msg = `We sent a sign-in link to ${email}. Open it on this device, or type the code from the email below.`;
  }
  async function enterCode(code) {
    code = String(code || '').replace(/\D/g, '');
    if (!A.pending) throw new Error('Ask for a new link first.');
    if (code.length !== 8) throw new Error('The code has 8 digits.');
    await authOtp(A.pending.otpId, code);
  }
  async function authOtp(otpId, password) {
    const d = await api('POST', '/api/collections/users/auth-with-otp', { otpId, password });
    A.auth = { token: d.token, user: d.record }; lsSet(KEY, A.auth); A.pending = null; try { sessionStorage.removeItem(PENDING_KEY); } catch (e) {}
    await loadMe(); A.view = A.me && A.me.family ? (isViewer() || A.me.me.confirmed ? 'dash' : 'confirm') : 'start'; A.msg = ''; subscribe();
  }
  function signOutLocal() { A.auth = null; A.me = null; A.view = 'signin'; A.propDays = new Set(); A.propEx = []; lsSet(KEY, null); unsubscribe(); }
  function signOut() { const v = isViewer() || !!lsGet('cc_viewer'); signOutLocal(); A.approved = null; lsSet(APPROVED_KEY, null); lsSet('cc_viewer', null); if (v) { STATE = planDefaults(); rebuild(); A.msg = 'Signed out. The parents\' calendar is no longer shown on this device.'; } else A.msg = 'Signed out. The calendar in this browser is kept.'; render(); }

  // ---------- family ----------
  async function loadMe() {
    if (!A.auth) return;
    const me = await api('GET', '/api/cc/me');
    const wasViewer = isViewer() || !!lsGet('cc_viewer');
    A.me = me;
    if (me.family && me.readonly) lsSet('cc_viewer', true); else lsSet('cc_viewer', null);
    if (wasViewer && !me.family) { STATE = planDefaults(); rebuild(); A.err = 'A parent ended your access to that calendar. It is no longer shown on this device.'; A.view = 'start'; }
    if (me.family) adoptApproved(me.family.settings); else { A.approved = null; lsSet(APPROVED_KEY, null); }
    computeProposalMarks();
  }
  // The approved settings replace the local calendar unless this device holds an unsent draft.
  function adoptApproved(settings) {
    const prevApproved = A.approved; A.approved = clone(settings); lsSet(APPROVED_KEY, A.approved);
    const dirty = prevApproved ? isDirty(prevApproved) : false; // was the local STATE a draft against the previous approved copy?
    if (!dirty) { if (!lsGet('cc5_before_join') && !prevApproved && STATE && !sameSettings(STATE, settings)) lsSet('cc5_before_join', STATE); STATE = clone(settings); STATE.setupDone = true; rebuild(); }
    else UI.note = isViewer() ? 'The shared calendar changed while you were trying things. Your what-if is kept; press Back to the shared calendar to see the latest.' : 'The shared calendar changed while you were editing. Your draft is kept; send or discard it to see the latest.';
  }
  const stripVolatile = (s) => { const c = clone(s); delete c.setupDone; return c; };
  const sameSettings = (a, b) => CCEngine.stable(stripVolatile(a)) === CCEngine.stable(stripVolatile(b));
  function isDirty(ref) { return !!(A.approved && STATE && !sameSettings(STATE, ref || A.approved)); }
  function inFamily() { return !!(A.me && A.me.family); }
  function isViewer() { return !!(A.me && A.me.readonly); }
  const VLABEL = { attorney: 'attorney', mediator: 'mediator', gal: 'guardian ad litem', other: 'third party' };
  function viewerText(v) { return `${v.name} (${VLABEL[v.label] || v.label}${v.for_role ? ` for ${roleName(v.for_role)}` : ''})`; }
  function active() { return inFamily() ? A.me.members.filter((m) => !m.left) : []; }
  function other() { return inFamily() ? active().find((m) => !m.me) || null : null; }
  function roleName(role) { const s = A.approved || STATE; return CCEngine.slotName(s, role); }
  function otherName() { const o = other(); return o ? roleName(o.role) : 'the other parent'; }
  function alone() { return inFamily() && active().length < 2; }

  async function createFamily(role) {
    if (!STATE) throw new Error('Set up the calendar first.');
    const s = clone(STATE); s.setupDone = true;
    const summary = `Schedule set up: ${regularText()}; ${phaseText()}; ${Object.values(s.holidays).filter((h) => h.on).length} holidays; ${s.cal.limit}-day limit`;
    const d = await api('POST', '/api/cc/families', { role, settings: s, summary });
    A.me = Object.assign({ user: A.me && A.me.user }, d); adoptApproved(d.family.settings); computeProposalMarks(); A.view = 'link'; A.msg = 'Your shared calendar is ready. Give the other parent the code below.'; subscribe();
  }
  async function join(code) {
    const d = await api('POST', '/api/cc/join', { code });
    A.me = Object.assign({ user: A.me && A.me.user }, d); adoptApproved(d.family.settings); computeProposalMarks(); A.view = d.readonly || d.me.confirmed ? 'dash' : 'confirm'; startViewerPoll(); A.msg = d.readonly ? 'You now view this calendar. Nothing you change here reaches the parents; it stays a what-if on this device.' : ''; subscribe();
  }
  async function confirm() { const d = await api('POST', '/api/cc/confirm', {}); A.me = Object.assign({ user: A.me.user }, d); adoptApproved(d.family.settings); computeProposalMarks(); A.view = 'dash'; A.msg = 'Confirmed. Both calendars now update together.'; }
  async function rotateFeed() { const d = await api('POST', '/api/cc/feed/rotate', {}); A.me.me.feed = d.feed; A.msg = 'New shared calendar URL made. The old one stopped working.'; }
  async function leave() { await api('POST', '/api/cc/leave', {}); A.me = { user: A.me.user, family: null }; A.approved = null; lsSet(APPROVED_KEY, null); A.view = 'start'; A.msg = 'You left the shared calendar. The calendar in this browser is yours alone again.'; computeProposalMarks(); }

  // ---------- drafts and proposals ----------
  // The draft on this device becomes one proposal per item changed, plus one for the settings if they differ.
  function draftProposals() {
    if (!inFamily() || isViewer() || !isDirty()) return [];
    const a = A.approved, b = clone(STATE); const d = CCEngine.diffSettings(a, b); const out = [];
    for (const it of d.items) {
      if (it.op === 'remove') out.push({ kind: 'remove', payload: { list: it.list, id: it.item.id }, summary: `Remove: ${itemText(it.list, it.item)}` });
      else out.push({ kind: it.list === 'changes' ? 'change' : 'vacation', payload: { item: it.item }, summary: `${it.op === 'edit' ? 'Change: ' : ''}${itemText(it.list, it.item)}` });
    }
    if (d.sections.length) {
      const names = { people: 'parents and children', regular: 'long distance schedule', local: 'local schedule', change: 'which schedule is in force', hol: 'holidays', vac: 'vacation rules', limits: 'limits and range', xch: 'exchange rules' };
      let delta = ''; try { const r0 = CCEngine.build(a).result, r1 = CCEngine.build(CCEngine.applyProposal(a, 'settings', { settings: b })).result; const dd = CCEngine.diffDays(r0, r1); delta = dd.length ? `; ${dd.length} day${dd.length === 1 ? '' : 's'} change, first ${fD(parseDate(dd[0]))}` : '; no day changes hands'; } catch (e) {}
      out.push({ kind: 'settings', payload: { settings: b }, summary: `Settings: ${d.sections.map((k) => names[k]).join(', ')}${delta}` });
    }
    return out;
  }
  function itemText(list, item) {
    if (list === 'changes') return `${item.note ? item.note + ': ' : ''}${changeTextFor(item)}`;
    return `${roleName(item.who)}'s vacation ${usdStr(item.s)} ${item.sh || ''} to ${usdStr(item.e)} ${item.eh || ''}${item.note ? ' (' + item.note + ')' : ''}`;
  }
  function changeTextFor(ch) { return CCEngine.changeSummary(A.approved || STATE, ch); }
  async function sendDraft(note, answerBy) {
    const list = draftProposals(); if (!list.length) return;
    const extra = { note: note || '' }; if (answerBy) extra.answer_by = answerBy;
    const co = A.counterOf ? A.me.proposals.find((q) => q.id === A.counterOf && q.status === 'open') : null;
    for (const p of list) {
      const isCounter = co && p.kind !== 'settings' && p.kind !== 'remove' && p.payload.item && co.payload && co.payload.item && p.payload.item.id === co.payload.item.id;
      const d = await api('POST', isCounter ? `/api/cc/proposals/${co.id}/counter` : '/api/cc/proposals', Object.assign({}, extra, p)); A.me = Object.assign({ user: A.me.user }, d);
    }
    A.counterOf = null;
    const fam = A.me.family; A.approved = clone(fam.settings); lsSet(APPROVED_KEY, A.approved); STATE = clone(fam.settings); STATE.setupDone = true; rebuild(); computeProposalMarks();
    A.msg = alone() ? `${list.length === 1 ? 'Change' : list.length + ' changes'} applied. Marked "not yet confirmed" until ${otherName()} joins and confirms.` : `Sent to ${otherName()} for approval. Your calendar shows the approved schedule until they answer.`;
    A.view = 'dash';
  }
  function discardDraft() { if (!A.approved) return; STATE = clone(A.approved); STATE.setupDone = true; rebuild(); A.counterOf = null; A.msg = 'Draft discarded.'; }
  // Counter-offer: the other parent's item becomes a draft on this device to edit; sending it answers their proposal.
  function startCounter(id) {
    const p = A.me.proposals.find((q) => q.id === id); if (!p || !p.payload || !p.payload.item) { A.err = 'That proposal cannot be countered here.'; return; }
    const item = clone(p.payload.item);
    if (p.kind === 'vacation') { STATE.vacations = STATE.vacations || {}; STATE.vacations.list = (STATE.vacations.list || []).filter((v) => v.id !== item.id); STATE.vacations.list.push(item); }
    else { STATE.changes = (STATE.changes || []).filter((c) => c.id !== item.id); STATE.changes.push(item); }
    A.counterOf = id; UI.openChg = item.id; rebuild();
    A.msg = `Edit the dates or times, then send. Sending answers ${E(otherName())}'s proposal with your version.`;
    go('set', p.kind === 'vacation' ? 'vac' : 'changes');
  }
  // OFW text for a proposal (the request) or for its answer.
  function ofwFor(p, answer) {
    const S = A.approved || STATE; const by = A.me.members.find((m) => m.id === p.proposed_by); const from = by ? by.role : null; const to = from ? (from === 'M' ? 'F' : 'M') : null;
    const item = p.payload && p.payload.item; const isChange = !!item && (p.kind === 'change' || p.kind === 'care');
    const ch = isChange ? item : { kind: 'give' };
    const opts = { from, to, answerBy: p.answer_by || '', note: p.note || '' };
    if (!isChange) opts.what = p.summary;
    if (p.kind === 'care') { opts.care = true; opts.kindName = 'First option to care'; opts.section = 'Section II.I, First Option to Care'; opts.from = p.payload.away || from; opts.to = opts.from === 'M' ? 'F' : 'M'; }
    if (answer) {
      const dm = A.me.members.find((m) => m.id === p.decided_by); opts.from = dm ? dm.role : to; opts.note = p.decided_note || '';
      opts.answer = p.status === 'approved' ? 'approve' : p.status === 'declined' ? 'decline' : p.status === 'countered' ? 'counter' : 'withdraw';
      if (p.status === 'countered') { const c = A.me.proposals.find((q) => q.replaces === p.id); if (c && c.payload && c.payload.item) opts.counter = c.payload.item; }
    }
    return CCEngine.ofwText(S, ch, opts);
  }
  async function careRequest(d) {
    const me = A.me.me; const o = other(); if (!o) throw new Error('The other parent has not joined yet.');
    const summary = `${roleName(me.role)} will be away ${usdStr(d.s)} ${d.sh} to ${usdStr(d.e)} ${d.eh}; first option to care offered to ${roleName(o.role)} (Parenting Plan II.I)`;
    const body = { kind: 'care', payload: { s: d.s, sh: d.sh, e: d.e, eh: d.eh, note: d.note || '' }, summary, note: d.note || '' }; if (d.answer_by) body.answer_by = d.answer_by;
    const r = await api('POST', '/api/cc/proposals', body); A.me = Object.assign({ user: A.me.user }, r); adoptApproved(r.family.settings); computeProposalMarks();
    A.msg = `Sent. ${roleName(o.role)} can take the time (it becomes their parenting time) or decline; either way the record keeps it.`; A.view = 'dash';
  }
  async function decide(id, action, note) {
    const d = await api('POST', `/api/cc/proposals/${id}/${action}`, { note: note || '' });
    A.me = Object.assign({ user: A.me.user }, d); adoptApproved(d.family.settings); computeProposalMarks(); A.declineFor = null;
    A.msg = action === 'approve' ? 'Approved. Both calendars show the change.' : action === 'decline' ? 'Declined. The other parent sees your reason.' : 'Withdrawn.';
  }
  // Days and exchanges that would change if each open proposal were approved; the calendar marks them.
  function computeProposalMarks() {
    A.propDays = new Set(); A.propEx = [];
    if (!inFamily()) return;
    let r0; try { r0 = CCEngine.build(A.approved).result; } catch (e) { return; }
    for (const p of A.me.proposals.filter((p) => p.status === 'open')) {
      try { const r1 = CCEngine.build(CCEngine.applyProposal(A.approved, p.kind, p.payload)).result; for (const k of CCEngine.diffDays(r0, r1)) A.propDays.add(k); const dx = CCEngine.diffExchanges(r0, r1); p._preview = previewText(r0, r1, dx); } catch (e) { p._preview = 'Cannot be applied to the current calendar: ' + e.message; }
    }
  }
  function previewText(r0, r1, dx) {
    const dd = CCEngine.diffDays(r0, r1); const names = { M: roleName('M'), F: roleName('F') };
    const ex = [...dx.removed.map((x) => `${fD(x.t)} ${hm(x.t)} exchange removed`), ...dx.added.map((x) => `exchange ${fD(x.t)} ${hm(x.t)} to ${names[x.to]}`)];
    if (!dd.length && !ex.length) return 'No day changes hands.';
    return `${dd.length ? `${dd.length} day${dd.length === 1 ? '' : 's'} change${dd.length === 1 ? 's' : ''} (${dd.slice(0, 3).map((k) => fD(parseDate(k))).join(', ')}${dd.length > 3 ? ', ...' : ''})` : ''}${ex.length ? (dd.length ? '; ' : '') + ex.slice(0, 3).join('; ') + (ex.length > 3 ? '; ...' : '') : ''}.`;
  }

  // ---------- realtime: the other parent's actions arrive without a reload ----------
  function subscribe() {
    unsubscribe(); if (!A.auth || !inFamily() || typeof EventSource === 'undefined') return;
    try {
      const es = new EventSource('/api/realtime'); A.es = es;
      es.addEventListener('PB_CONNECT', async (ev) => {
        try { const { clientId } = JSON.parse(ev.data); await api('POST', '/api/realtime', { clientId, subscriptions: [`families/${A.me.family.id}`, 'proposals', 'events', 'members'] }); } catch (e) {}
      });
      for (const topic of [`families/${A.me.family.id}`, 'proposals', 'events', 'members']) es.addEventListener(topic, () => scheduleReload());
    } catch (e) {}
  }
  function unsubscribe() { if (A.es) { try { A.es.close(); } catch (e) {} A.es = null; } }
  let viewerPoll = null;
  function startViewerPoll() { clearInterval(viewerPoll); if (isViewer()) viewerPoll = setInterval(async () => { try { await loadMe(); if (!inFamily()) { clearInterval(viewerPoll); go('acct'); } else render(); } catch (e) {} }, 120000); }
  function scheduleReload() { clearTimeout(A.loadTimer); A.loadTimer = setTimeout(async () => { try { await loadMe(); render(); } catch (e) {} }, 400); }

  // ---------- start ----------
  async function init() {
    A.auth = lsGet(KEY); A.approved = lsGet(APPROVED_KEY); try { A.pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch (e) {}
    if (A.pending && Date.now() - A.pending.at > 15 * 60000) A.pending = null;
    const m = /#otp=([A-Za-z0-9]+)\.(\d{4,12})/.exec(location.hash);
    if (m) { history.replaceState(null, '', location.pathname + location.search); try { await authOtp(m[1], m[2]); go('acct'); return; } catch (e) { A.err = 'That sign-in link did not work (used already or older than 15 minutes). Ask for a new one.'; A.view = 'signin'; go('acct'); return; } }
    let wantAcct = false; if (location.hash === '#acct') { history.replaceState(null, '', location.pathname + location.search); wantAcct = true; }
    if (A.auth) {
      try { const d = await api('POST', '/api/collections/users/auth-refresh'); A.auth = { token: d.token, user: d.record }; lsSet(KEY, A.auth); await loadMe(); A.view = inFamily() ? (isViewer() || A.me.me.confirmed ? 'dash' : 'confirm') : 'start'; subscribe(); }
      catch (e) { if (!A.auth) A.view = 'signin'; else A.err = 'Could not reach the server; showing the last approved calendar saved on this device.'; }
    } else if (A.pending) A.view = 'code';
    A.ready = true; startViewerPoll(); if (wantAcct) go('acct'); else { render(); rerender(); } updateTab();
  }

  // ---------- rendering ----------
  const E = (s) => esc(s);
  function needsMe() { return inFamily() && !isViewer() ? A.me.proposals.filter((p) => p.status === 'open' && p.proposed_by !== A.me.me.id) : []; }
  function updateTab() {
    const t = document.getElementById('tab-acct'); if (!t) return;
    const n = needsMe().length;
    t.innerHTML = A.auth ? `Dashboard${n ? ` <span class="badge">${n}</span>` : ''}` : 'Sign in';
    const tag = document.querySelector('.brand .tag'); if (tag) tag.textContent = isViewer() ? `read-only view of ${E(roleName('M'))} and ${E(roleName('F'))}'s calendar` : inFamily() ? `shared with ${E(otherName())}` : 'works without an account; sign in to share it with the other parent';
  }
  // Banner shown on the Calendar and Settings places while a draft is unsent or a proposal waits.
  function banner() {
    if (!A.ready || !inFamily()) return '';
    let h = '';
    if (isViewer()) { if (isDirty()) h += `<div class="banner draft"><span><b>What-if.</b> These changes exist only on this device. The parents' shared calendar is unchanged, and viewers cannot change it.</span><span class="row"><button class="btn sm" data-acct="discard">Back to the shared calendar</button></span></div>`; return h; }
    if (isDirty()) { const n = draftProposals().length; h += `<div class="banner draft"><span><b>Draft.</b> ${n === 1 ? 'One change' : n + ' changes'} on this device ${alone() ? 'not yet saved to the shared calendar' : `not yet sent to ${E(otherName())}`}.</span><span class="row"><button class="btn sm primary" data-acct="send">${alone() ? 'Save to the shared calendar' : `Send to ${E(otherName())} for approval`}</button><button class="btn sm quiet" data-acct="discard">Discard</button></span></div>`; }
    const n = needsMe().length; if (n) h += `<div class="banner"><span>${n === 1 ? 'A proposal from' : n + ' proposals from'} ${E(otherName())} ${n === 1 ? 'needs' : 'need'} your answer.</span><button class="btn sm" data-go="acct">Open the dashboard</button></div>`;
    if (!A.me.me.confirmed) h += `<div class="banner"><span>You have not confirmed this schedule yet. It is in force as it stands.</span><button class="btn sm" data-acct="view" data-arg="confirm">Review and confirm</button></div>`;
    return h;
  }
  function render() {
    updateTab(); const el = document.getElementById('place-acct'); if (!el || UI.place !== 'acct') return;
    let h = '';
    if (A.err) h += `<div class="banner err">${E(A.err)}</div>`;
    if (A.msg) h += `<div class="banner">${E(A.msg)}</div>`;
    if (!A.auth) h += A.view === 'code' ? codeHtml() : signinHtml();
    else if (!inFamily()) h += startHtml();
    else if (isViewer()) h += A.view === 'record' ? recordHtml() : viewerDashHtml();
    else if (A.view === 'confirm' || !A.me.me.confirmed && A.view !== 'record' && A.view !== 'link') h += confirmHtml();
    else if (A.view === 'link') h += linkHtml();
    else if (A.view === 'record') h += recordHtml();
    else h += dashHtml();
    el.innerHTML = h;
    const f = el.querySelector('input[autofocus]'); if (f) f.focus();
  }
  function signinHtml() {
    return `<div class="acct"><div class="card"><span class="eyebrow">Sign in</span><h2>Sign in with your email</h2><p class="muted">No password. We email you a link that signs you in on this device.</p>
      <form class="row" data-acct-form="signin"><input type="email" name="email" required autocomplete="email" placeholder="you@example.com" autofocus style="flex:1;min-width:220px"><button class="btn primary" type="submit">Email me a sign-in link</button></form>
      <p class="small muted">The calendar works without an account. An account adds: the same calendar on both parents' phones, changes that the other parent approves before they apply, a record of who changed what and when, and a shared calendar URL for your calendar app.</p></div>
      <div class="card"><h3>What happens after the first sign-in</h3><ol class="small muted" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px"><li>Say which parent you are. The calendar set up in this browser becomes the shared calendar.</li><li>Give the other parent a code. They sign in with their own email, enter the code and confirm the schedule as it stands.</li><li>From then on, a change either parent makes is a proposal the other approves.</li></ol></div></div>`;
  }
  function codeHtml() {
    return `<div class="acct"><div class="card"><span class="eyebrow">Sign in</span><h2>Check your email</h2><p class="muted">Open the link in the email on this device, or type the 8-digit code from it here.</p>
      <form class="row" data-acct-form="code"><input inputmode="numeric" pattern="[0-9 ]*" name="code" required placeholder="12345678" autofocus class="mono" style="flex:1;min-width:160px;letter-spacing:2px"><button class="btn primary" type="submit">Sign in</button></form>
      <p class="small muted">Sent to ${E(A.pending ? A.pending.email : '')}. The code works for 15 minutes. <button class="btn sm quiet" data-acct="view" data-arg="signin">Use another address</button></p></div></div>`;
  }
  function startHtml() {
    const have = STATE && STATE.setupDone;
    return `<div class="acct"><div class="card"><span class="eyebrow">Signed in as ${E(A.me ? A.me.user.email : '')}</span><h2>Share a calendar</h2>
      <div class="grid2">
        <div class="panel"><h3>Start from this calendar</h3><p class="small muted">${have ? 'The calendar set up in this browser becomes the shared one. You are:' : 'Set up the calendar first (Setup tab), then come back here.'}</p>${have ? `<div class="row"><button class="btn primary" data-acct="create" data-arg="M">${E(CCEngine.slotName(STATE, 'M'))}</button><button class="btn primary" data-acct="create" data-arg="F">${E(CCEngine.slotName(STATE, 'F'))}</button></div>` : `<button class="btn" data-go="setup">Open Setup</button>`}</div>
        <div class="panel"><h3>Join with a code</h3><p class="small muted">The other parent already set it up and gave you a code.</p><form class="row" data-acct-form="join"><input name="code" required placeholder="ABCD-EFGH" class="mono" style="text-transform:uppercase;flex:1;min-width:140px"><button class="btn" type="submit">Join</button></form><p class="small muted">Joining replaces the calendar in this browser with the shared one. A copy of the current one is kept on this device.</p></div>
      </div>
      <div class="row" style="margin-top:12px"><button class="btn sm quiet" data-acct="signout">Sign out</button></div></div></div>`;
  }
  function confirmHtml() {
    const s = A.approved; const unconf = A.me.proposals.filter((p) => p.unconfirmed).length;
    return `<div class="acct"><div class="card"><span class="eyebrow">Step 2 of 2</span><h2>Confirm the schedule</h2><p class="muted">${E(otherName())} set this up. It is in force now, as it stands. Confirming records that you have seen it; it does not change the calendar. Anything you want changed goes through a proposal afterwards.</p>
      <dl class="kv"><dt>Parents</dt><dd><span class="who M">${E(CCEngine.slotName(s, 'M'))}</span> &nbsp; <span class="who F">${E(CCEngine.slotName(s, 'F'))}</span></dd><dt>Long distance</dt><dd>${E(regularText())}</dd><dt>Local</dt><dd>${E(localText())}</dd><dt>In force</dt><dd>${E(phaseText())}</dd><dt>Holidays</dt><dd>${Object.values(s.holidays).filter((h) => h.on).length} selected</dd><dt>Limit</dt><dd>${s.cal.limit} days; calendar from ${E(usdStr(s.cal.start))} for ${s.cal.years} years</dd>${unconf ? `<dt>Earlier changes</dt><dd>${unconf} change${unconf === 1 ? '' : 's'} ${E(otherName())} made before you joined, marked "not yet confirmed". Confirming covers them too; the record keeps each one.</dd>` : ''}</dl>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-acct="confirm">Confirm this schedule</button><button class="btn" data-go="cal">Look at the calendar first</button><button class="btn quiet" data-acct="view" data-arg="record">See the record</button></div></div></div>`;
  }
  function propItem(p, mine) {
    const pm = A.me.members.find((m) => m.id === p.proposed_by); const by = pm ? roleName(pm.role) + (pm.left ? ' (left)' : '') : 'a parent no longer on record';
    const when = fDT(parseDateTime(p.created));
    const pill = p.status === 'open' ? `<span class="pill w">${isViewer() ? 'open' : mine ? 'waiting' : 'needs your answer'}</span>` : p.status === 'approved' ? `<span class="pill ok">approved${p.unconfirmed ? ', not yet confirmed' : ''}</span>` : `<span class="pill">${E(p.status)}</span>`;
    let actions = '';
    if (isViewer()) actions = '';
    else if (p.status === 'open' && !mine) actions = A.declineFor === p.id ? `<form class="row" data-acct-form="decline" data-id="${p.id}"><input name="note" required placeholder="One-line reason" autofocus style="flex:1;min-width:160px"><button class="btn sm" type="submit">Decline</button><button class="btn sm quiet" type="button" data-acct="declineCancel">Cancel</button></form>` : `<span class="row"><button class="btn sm primary" data-acct="approve" data-arg="${p.id}">${p.kind === 'care' ? 'Take the time' : 'Approve'}</button><button class="btn sm" data-acct="decline" data-arg="${p.id}">Decline</button>${(p.kind === 'change' || p.kind === 'vacation' || p.kind === 'care') && p.payload && p.payload.item ? `<button class="btn sm" data-acct="counter" data-arg="${p.id}">Counter</button>` : ''}<button class="btn sm quiet" data-acct="ofw" data-arg="${p.id}" title="Copy the request text for OFW">OFW text</button></span>`;
    else if (p.status === 'open' && mine) actions = `<span class="row"><button class="btn sm quiet" data-acct="withdraw" data-arg="${p.id}">Withdraw</button><button class="btn sm quiet" data-acct="ofw" data-arg="${p.id}" title="Copy the request text for OFW">OFW text</button></span>`;
    else actions = `<span class="row"><button class="btn sm quiet" data-acct="ofw" data-arg="${p.id}" title="Copy the request text for OFW">OFW request</button>${p.decided_by || p.status === 'expired' ? `<button class="btn sm quiet" data-acct="ofwAnswer" data-arg="${p.id}" title="Copy the answer text for OFW">OFW answer</button>` : ''}</span>`;
    const rep = p.replaces ? A.me.proposals.find((q) => q.id === p.replaces) : null; const replacesText = rep ? `<br>Counter-offer to: ${E(rep.summary)}` : '';
    const answerBy = p.answer_by ? ` · answer by ${E(usdStr(p.answer_by))}${p.status === 'open' && !mine ? ' (closes on its own after that day)' : ''}` : '';
    const dm = A.me.members.find((m) => m.id === p.decided_by); const decided = p.decided_at ? `<br>${E(p.status)}${dm ? ` by ${E(roleName(dm.role))}` : ''} ${fDT(parseDateTime(p.decided_at))}${p.decided_note ? `: "${E(p.decided_note)}"` : ''}` : '';
    return `<div class="item">${pill}<div><b>${E(p.summary)}</b><div class="res">Proposed by ${E(by)} · ${when}${answerBy}${p.note ? ` · "${E(p.note)}"` : ''}${replacesText}${p._preview ? `<br>Result if approved: ${E(p._preview)}` : ''}${decided}</div></div>${actions}</div>`;
  }
  function dashHtml() {
    const r = RESULT; const now = nowT(); const nx = r && r.exchanges.find((x) => x.t > now);
    const o = other(); const open = A.me.proposals.filter((p) => p.status === 'open'); const forMe = open.filter((p) => p.proposed_by !== A.me.me.id), mine = open.filter((p) => p.proposed_by === A.me.me.id);
    const recent = A.me.proposals.filter((p) => p.status !== 'open').slice(0, 5);
    const draft = draftProposals();
    return `<div class="acct">
      <div class="today">
        <div><span class="eyebrow">Next exchange</span>${nx ? `<span class="big">${fD(nx.t)}, <span class="mono">${hm(nx.t)}</span></span><span class="small muted">to <span class="who ${nx.to}">${E(roleName(nx.to))}</span> · ${humanWhy(nx)}</span>` : '<span class="big">none in range</span>'}</div>
        <div><span class="eyebrow">Linked parent</span><span class="big">${o ? `${E(roleName(o.role))}, ${o.confirmed ? 'linked' : 'joined, not yet confirmed'}` : 'not yet joined'}</span><span class="small muted">${o ? 'Both see the same calendar. Changes need the other parent’s approval.' : 'Your changes apply right away, marked "not yet confirmed", until the other parent joins.'}</span></div>
        <div><span class="eyebrow">You</span><span class="big"><span class="who ${A.me.me.role}">${E(roleName(A.me.me.role))}</span></span><span class="small muted">${E(A.me.user.email)}</span></div>
      </div>
      ${draft.length ? `<div class="panel"><div class="row" style="justify-content:space-between"><h3>Your draft</h3><span class="pill w">${draft.length}</span></div><div class="list">${draft.map((d) => `<div class="item"><span class="pill c">${E(d.kind)}</span><div><b>${E(d.summary)}</b></div><span></span></div>`).join('')}</div><form class="row" data-acct-form="send" style="margin-top:10px"><input name="note" placeholder="Reason (optional, the other parent sees it)" style="flex:1;min-width:200px">${alone() ? '' : `<label class="small muted" style="display:flex;align-items:center;gap:6px">Answer by <input type="date" name="answer_by" title="Optional. A reminder goes out the day before; unanswered proposals close after this day."></label>`}<button class="btn primary" type="submit">${alone() ? 'Save to the shared calendar' : A.counterOf ? `Send counter-offer to ${E(otherName())}` : `Send to ${E(otherName())} for approval`}</button><button class="btn quiet" type="button" data-acct="discard">Discard</button></form>${A.counterOf ? `<p class="small muted">This draft answers ${E(otherName())}'s proposal with your version. Their proposal is marked "countered" when you send.</p>` : ''}</div>` : ''}
      ${forMe.length ? `<div class="panel"><div class="row" style="justify-content:space-between"><h3>Needs your approval</h3><span class="pill w">${forMe.length}</span></div><div class="list">${forMe.map((p) => propItem(p, false)).join('')}</div><p class="small muted">Approving applies the change to both calendars at once and writes it to the record. Declining asks for a one-line reason the other parent sees. Nothing is approved by silence.</p></div>` : ''}
      ${mine.length ? `<div class="panel"><h3>Waiting for ${E(otherName())}</h3><div class="list">${mine.map((p) => propItem(p, true)).join('')}</div></div>` : ''}
      <div class="panel"><h3>Make a change</h3><p class="small muted">Edit the calendar as usual: tap a day to move an exchange, swap it, add a vacation or give a day; or change settings. The edits stay a draft on this device until you send them${o ? ` to ${E(otherName())}` : ''}.</p><div class="row"><button class="btn" data-go="cal">Open the calendar</button><button class="btn" data-go="set">Open settings</button></div></div>
      ${o ? `<div class="panel"><h3>Away for more than eight hours? Offer the time first</h3><p class="small muted">The plan (II.I, First Option to Care) says a parent away from the child for more than eight hours during their time offers the other parent the first option to care. This sends that offer; if ${E(otherName())} takes it, the time becomes theirs on the calendar; if not, the record shows the offer was made.</p>
        <form class="form tight" data-acct-form="care"><div class="field"><span class="lbl">Away from</span><input type="date" name="s" required></div><div class="field"><span class="lbl">at</span><input type="time" name="sh" value="17:00" step="900" required></div><div class="field"><span class="lbl">Until</span><input type="date" name="e" required></div><div class="field"><span class="lbl">at</span><input type="time" name="eh" value="10:00" step="900" required></div><div class="field"><span class="lbl">Note (optional)</span><input name="note" placeholder="Work trip"></div><div class="field"><span class="lbl">Answer by (optional)</span><input type="date" name="answer_by"></div><div class="field"><span class="lbl">&nbsp;</span><button class="btn sm primary" type="submit">Offer the time to ${E(otherName())}</button></div></form></div>` : ''}
      <div class="grid2">
        <div class="panel"><h3>Shared calendar URL</h3><p class="small muted">A private URL that updates itself when a change is approved. Add it once to Apple Calendar, Google Calendar, Proton Calendar or Outlook (subscribe to a calendar by URL). Anyone with the URL can read the calendar; make a new one if it leaks.</p>${(()=>{ const base=`${location.origin}/api/cc/feed/${A.me.me.feed}.ics`; const S0=A.approved||STATE; return `<input class="mono small" readonly id="feedUrl" value="${E(base)}" style="width:100%;font:inherit;font-family:var(--mono);font-size:12px;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)"><div class="row" style="margin-top:8px"><button class="btn sm" data-acct="copyFeed">Copy URL</button><button class="btn sm quiet" data-acct="rotate">Make a new URL</button></div>
          <p class="small muted" style="margin-top:10px">One calendar per parent, so each can have its own color in your calendar app (the page's colors are sent along; Proton and Google use the color you pick for the subscribed calendar). Each carries that parent's blocks and every exchange. Add both:</p>
          ${['M','F'].map(k=>`<div class="row" style="margin-top:6px;align-items:center"><span class="who ${k}" style="min-width:90px">${E(roleName(k))}'s time</span><input class="mono small" readonly value="${E(base)}?who=${k}" style="flex:1;min-width:200px;font:inherit;font-family:var(--mono);font-size:12px;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)"><button class="btn sm" data-acct="copyText" data-arg="${E(base)}?who=${k}">Copy</button></div>`).join('')}`; })()}</div>
        <div class="panel"><h3>Record and sharing</h3><p class="small muted">Every change, who asked, who decided, and when.</p><div class="row"><button class="btn sm" data-acct="view" data-arg="record">See the record</button><button class="btn sm" data-acct="view" data-arg="link">${o ? 'Linked parent' : 'Invite the other parent'}</button><button class="btn sm quiet" data-acct="signout">Sign out</button></div></div>
      </div>
      ${recent.length ? `<div class="panel"><h3>Recently decided</h3><div class="list">${recent.map((p) => propItem(p, p.proposed_by === A.me.me.id)).join('')}</div></div>` : ''}
    </div>`;
  }
  function viewerDashHtml() {
    const r = RESULT; const now = nowT(); const nx = r && r.exchanges.find((x) => x.t > now);
    const open = A.me.proposals.filter((p) => p.status === 'open'); const recent = A.me.proposals.filter((p) => p.status !== 'open').slice(0, 8);
    const me = A.me.me;
    return `<div class="acct">
      <div class="today">
        <div><span class="eyebrow">Next exchange</span>${nx ? `<span class="big">${fD(nx.t)}, <span class="mono">${hm(nx.t)}</span></span><span class="small muted">to <span class="who ${nx.to}">${E(roleName(nx.to))}</span> · ${humanWhy(nx)}</span>` : '<span class="big">none in range</span>'}</div>
        <div><span class="eyebrow">Parents</span><span class="big"><span class="who M">${E(roleName('M'))}</span> &nbsp; <span class="who F">${E(roleName('F'))}</span></span><span class="small muted">${active().length === 2 ? 'Both parents are linked.' : 'One parent has set this up; the other has not joined yet.'}</span></div>
        <div><span class="eyebrow">You</span><span class="big">${E(me.name)}</span><span class="small muted">${E(VLABEL[me.label] || me.label)}${me.for_role ? ` for ${E(roleName(me.for_role))}` : ''} · read-only · ${E(A.me.user.email)}</span></div>
      </div>
      <div class="notice">You see the calendar the parents share, every proposal and the record. You can open Settings and Setup and try changes; they stay on this device as a what-if and never reach the parents. Either parent can end this access.</div>
      ${open.length ? `<div class="panel"><div class="row" style="justify-content:space-between"><h3>Open proposals</h3><span class="pill w">${open.length}</span></div><div class="list">${open.map((p) => propItem(p, false)).join('')}</div></div>` : '<div class="panel"><h3>Open proposals</h3><p class="small muted">None.</p></div>'}
      <div class="grid2">
        <div class="panel"><h3>Shared calendar URL</h3><p class="small muted">A private URL for you alone; it updates when the parents approve a change and stops working when your access ends.</p>${(()=>{ const base=`${location.origin}/api/cc/feed/${me.feed}.ics`; const S0=A.approved||STATE; return `<input class="mono small" readonly id="feedUrl" value="${E(base)}" style="width:100%;font:inherit;font-family:var(--mono);font-size:12px;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)"><div class="row" style="margin-top:8px"><button class="btn sm" data-acct="copyFeed">Copy URL</button><button class="btn sm quiet" data-acct="rotate">Make a new URL</button></div>
          <p class="small muted" style="margin-top:10px">One calendar per parent, so each can have its own color in your calendar app (the page's colors are sent along; Proton and Google use the color you pick for the subscribed calendar). Each carries that parent's blocks and every exchange. Add both:</p>
          ${['M','F'].map(k=>`<div class="row" style="margin-top:6px;align-items:center"><span class="who ${k}" style="min-width:90px">${E(roleName(k))}'s time</span><input class="mono small" readonly value="${E(base)}?who=${k}" style="flex:1;min-width:200px;font:inherit;font-family:var(--mono);font-size:12px;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink)"><button class="btn sm" data-acct="copyText" data-arg="${E(base)}?who=${k}">Copy</button></div>`).join('')}`; })()}</div>
        <div class="panel"><h3>Record</h3><p class="small muted">Every change, who asked, who decided, and when.</p><div class="row"><button class="btn sm" data-acct="view" data-arg="record">See the record</button><button class="btn sm" data-go="cal">Open the calendar</button><button class="btn sm quiet" data-acct="signout">Sign out</button></div></div>
      </div>
      ${recent.length ? `<div class="panel"><h3>Recently decided</h3><div class="list">${recent.map((p) => propItem(p, false)).join('')}</div></div>` : ''}
    </div>`;
  }
  function viewersPanel() {
    const vs = (A.me.viewers || []).filter((v) => v.status !== 'revoked'); const gone = (A.me.viewers || []).filter((v) => v.status === 'revoked');
    const row = (v) => `<div class="item"><span class="pill${v.status === 'active' ? ' ok' : v.status === 'invited' ? ' w' : ''}">${E(v.status === 'invited' ? 'invited' : v.status)}</span><div><b>${E(viewerText(v))}</b><div class="res">${v.status === 'invited' ? `Code to give them: <span class="code" style="font-size:15px;padding:2px 8px">${E(v.code)}</span> <button class="btn sm" data-acct="copyText" data-arg="${E(v.code)}">Copy</button>` : v.status === 'active' ? `Signed in${v.email ? ` as ${E(v.email)}` : ''} ${v.activated ? fDT(parseDateTime(v.activated)) : ''}` : `Ended ${v.revoked_at ? fDT(parseDateTime(v.revoked_at)) : ''}`}</div></div>${v.status !== 'revoked' ? `<button class="btn sm danger" data-acct="revokeViewer" data-arg="${v.id}">${v.status === 'invited' ? 'Withdraw' : 'End access'}</button>` : '<span></span>'}</div>`;
    return `<div class="panel" style="margin-top:12px"><h3>Third-party viewers</h3><p class="small muted">An attorney, mediator or guardian ad litem can see the calendar, every proposal and the record, and gets a calendar address of their own. They cannot change anything; what they try in Settings stays on their own device. Either parent can invite or end access; the other parent is told each time, and the record keeps it.</p>
      ${vs.length ? `<div class="list">${vs.map(row).join('')}</div>` : '<p class="small muted">No viewers.</p>'}
      <form class="form tight" data-acct-form="viewer" style="margin-top:10px"><div class="field"><span class="lbl">Name</span><input name="name" required placeholder="Jane Doe"></div><div class="field"><span class="lbl">Who they are</span><select name="label"><option value="attorney">Attorney</option><option value="mediator">Mediator</option><option value="gal">Guardian ad litem</option><option value="other">Other</option></select></div><div class="field"><span class="lbl">For</span><select name="for_role"><option value="">both parents / neutral</option><option value="M">${E(roleName('M'))}</option><option value="F">${E(roleName('F'))}</option></select></div><div class="field"><span class="lbl">&nbsp;</span><button class="btn primary" type="submit">Invite</button></div></form>
      <p class="small muted">Inviting makes a code. Give it to them; they sign in at ${E(location.origin)} with their own email and enter the code.</p>
      ${gone.length ? `<details class="help"><summary>Ended (${gone.length})</summary><div class="list">${gone.map(row).join('')}</div></details>` : ''}</div>`;
  }
  function linkHtml() {
    const o = other(); const code = A.me.family.code;
    return `<div class="acct"><div class="card"><span class="eyebrow">Linked parent</span><h2>${o ? `Linked with ${E(roleName(o.role))}` : 'Link the other parent'}</h2>
      ${o ? `<p class="muted">${E(roleName(o.role))} (${E(o.email || '')}) is linked${o.confirmed ? ' and has confirmed the schedule' : ' and has not confirmed the schedule yet'}. Both calendars update together.</p>` : `<div class="steps-v">
        <div class="step"><span class="n">1</span><div><b>Give the other parent this code</b><div style="margin:8px 0"><span class="code">${E(code)}</span> <button class="btn sm" data-acct="copyCode">Copy</button></div><div class="small muted">By text, email or in person. It only lets one more person join this calendar.</div></div></div>
        <div class="step"><span class="n">2</span><div><b>They sign in with their own email and enter the code</b><div class="small muted">At ${E(location.origin)}, under Sign in. They become ${E(roleName(A.me.me.role === 'M' ? 'F' : 'M'))}.</div></div></div>
        <div class="step"><span class="n">3</span><div><b>They confirm the schedule as it stands</b><div class="small muted">It stays in force before and after. From then on, changes need the other parent's approval.</div></div></div></div>
        <div class="panel" style="margin-top:12px"><h3>Until the other parent joins</h3><p class="small muted">Your changes apply right away and are marked "not yet confirmed by the other parent". When they join and confirm, the marks clear; the record keeps each change.</p></div>`}
      ${viewersPanel()}
      <div class="row" style="margin-top:12px"><button class="btn" data-acct="view" data-arg="dash">Back to the dashboard</button><button class="btn quiet danger" data-acct="leave">Unlink me from this calendar</button></div>
      <p class="small muted">Unlinking keeps the calendar in this browser as it is now; the shared record stays with the other parent.</p></div></div>`;
  }
  function recordHtml() {
    const rows = A.me.events.map((ev) => { const m = A.me.members.find((x) => x.id === ev.actor); return `<tr><td class="mono small">${E(fDT(parseDateTime(ev.at)))}</td><td>${E(ev.action)}</td><td>${E(ev.detail)}</td><td>${m ? E(roleName(m.role)) + (m.left ? ' (left)' : '') : ''}</td></tr>`; }).join('');
    return `<div class="acct"><div class="card"><div class="row" style="justify-content:space-between"><div><span class="eyebrow">Record</span><h2>Every change to the calendar</h2><p class="muted">Who asked, who decided, and when. Nothing here can be edited or removed. Version numbers count approved changes to the shared settings.</p></div><button class="btn" data-acct="view" data-arg="dash">Back to the dashboard</button></div>
      <div class="tblbox"><table class="tbl"><thead><tr><th>When</th><th>What</th><th>Detail</th><th>By</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">Nothing yet.</td></tr>'}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-acct="copyRecord">Copy as text</button></div></div></div>`;
  }
  function parseDateTime(s) { const d = new Date(String(s).replace(' ', 'T')); return utc(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()) + d.getMinutes() * 60000; }

  // ---------- published calendar address (works without an account) ----------
  function pubInfo() { return lsGet('cc_pub'); }
  async function publish() {
    const prev = pubInfo() || {};
    const s = clone(STATE); s.setupDone = true;
    const d = await api('POST', '/api/cc/publish', { settings: s, id: prev.id, secret: prev.secret });
    lsSet('cc_pub', { id: d.id, secret: d.secret, version: d.version, at: new Date().toISOString() });
    return d;
  }
  // ---------- events from the page ----------
  async function run(fn) { if (A.busy) return; A.busy = true; try { await fn(); } catch (e) { A.err = e.message || String(e); } A.busy = false; render(); if (UI.place !== 'acct') rerender(); else { rebuild(); } updateTab(); }
  function action(act, arg, btn) {
    A.msg = ''; A.err = '';
    switch (act) {
      case 'view': A.view = arg; if (UI.place !== 'acct') go('acct'); else render(); return;
      case 'signout': signOut(); return;
      case 'create': run(() => createFamily(arg)); return;
      case 'confirm': run(() => confirm()); return;
      case 'send': run(async () => { await sendDraft(''); if (UI.place !== 'acct') go('acct'); }); return;
      case 'discard': discardDraft(); if (UI.place === 'acct') render(); else rerender(); return;
      case 'approve': run(() => decide(arg, 'approve', '')); return;
      case 'counter': startCounter(arg); return;
      case 'ofw': { const p = A.me.proposals.find((q) => q.id === arg); if (p) copy(ofwFor(p, false), 'OFW text copied. Paste it into an OFW message.'); return; }
      case 'ofwAnswer': { const p = A.me.proposals.find((q) => q.id === arg); if (p) copy(ofwFor(p, true), 'OFW answer text copied.'); return; }
      case 'decline': A.declineFor = arg; render(); return;
      case 'declineCancel': A.declineFor = null; render(); return;
      case 'withdraw': run(() => decide(arg, 'withdraw', '')); return;
      case 'rotate': run(() => rotateFeed()); return;
      case 'leave': if (btn && btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Tap again to unlink'; return; } run(() => leave()); return;
      case 'copyFeed': copy(document.getElementById('feedUrl').value, 'Shared calendar URL copied.'); return;
      case 'copyCode': copy(A.me.family.code, 'Code copied.'); return;
      case 'copyText': copy(arg, 'Copied.'); return;
      case 'revokeViewer': if (btn && btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Tap again to confirm'; return; } run(async () => { const d = await api('POST', `/api/cc/viewers/${arg}/revoke`, {}); A.me = Object.assign({ user: A.me.user }, d); A.msg = 'Access ended. The other parent is told, and the record keeps it.'; }); return;
      case 'copyRecord': copy(A.me.events.slice().reverse().map((ev) => `${ev.at.slice(0, 16)}  ${ev.action}  ${ev.detail}`).join('\n'), 'Record copied.'); return;
    }
  }
  async function copy(text, msg) { try { await navigator.clipboard.writeText(text); A.msg = msg; } catch (e) { A.err = 'Copy failed in this browser; select the text and copy it by hand.'; } render(); }
  function form(f) {
    A.msg = ''; A.err = '';
    const kind = f.dataset.acctForm; const data = Object.fromEntries(new FormData(f).entries());
    if (kind === 'signin') run(() => requestLink(data.email));
    else if (kind === 'code') run(() => enterCode(data.code));
    else if (kind === 'join') run(() => join(data.code));
    else if (kind === 'send') run(() => sendDraft(data.note, data.answer_by));
    else if (kind === 'care') run(() => careRequest(data));
    else if (kind === 'decline') run(() => decide(f.dataset.id, 'decline', data.note));
    else if (kind === 'viewer') run(async () => { const d = await api('POST', '/api/cc/viewers', { name: data.name, label: data.label, for_role: data.for_role }); A.me = Object.assign({ user: A.me.user }, d); A.view = 'link'; A.msg = `Invitation made for ${data.name}. Give them the code shown under Third-party viewers.`; });
  }
  document.addEventListener('submit', (e) => { const f = e.target.closest('form[data-acct-form]'); if (!f) return; e.preventDefault(); form(f); });

  return { A, init, render, banner, action, publish, pubInfo, inFamily, isViewer, isDirty, alone, otherName, needsMe, updateTab, propDays: () => A.propDays, signedIn: () => !!A.auth };
})();
