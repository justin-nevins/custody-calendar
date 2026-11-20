/// <reference path="../pb_data/types.d.ts" />
// Custody Calendar account routes. Every write to families, members, proposals and events goes through here, so the
// rules (who may approve, what a proposal may change, what the record says) live in one place and run on the server.
// Helpers are in cc_lib.js (required inside each handler: PocketBase gives every handler its own runtime).

// ---- sign in: make sure the account exists, then the client asks PocketBase for the one-time code ----
routerAdd("POST", "/api/cc/signin", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, freshCode, allMembersOf, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView, viewerOf, requireParent, viewerText } = require(`${__hooks}/cc_lib.js`);
  const email = String(body(e).email || "").trim().toLowerCase();
  if (!emailOk(email)) bad("Enter a valid email address.");
  let user = null;
  try { user = $app.findAuthRecordByEmail("users", email); } catch (_) {}
  if (!user) {
    user = new Record($app.findCollectionByNameOrId("users"));
    user.set("email", email);
    user.set("emailVisibility", false);
    user.setPassword($security.randomString(40));
    $app.save(user);
  }
  return e.json(200, { ok: true });
});

// ---- who am I, which family, what is open ----
routerAdd("GET", "/api/cc/me", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, freshCode, allMembersOf, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView, viewerOf, requireParent, viewerText } = require(`${__hooks}/cc_lib.js`);
  const me = memberOf($app, e.auth.id) || viewerOf($app, e.auth.id);
  if (!me) return e.json(200, { user: { id: e.auth.id, email: e.auth.email() }, family: null });
  const fam = $app.findRecordById("families", me.getString("family"));
  return e.json(200, Object.assign({ user: { id: e.auth.id, email: e.auth.email() } }, familyView($app, fam, me)));
}, $apis.requireAuth("users"));

// ---- start a shared calendar from the settings in this browser ----
routerAdd("POST", "/api/cc/families", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, freshCode, allMembersOf, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView, viewerOf, requireParent, viewerText } = require(`${__hooks}/cc_lib.js`);
    const b = body(e);
  const role = b.role === "F" ? "F" : b.role === "M" ? "M" : bad("Say which parent you are.");
  const settings = b.settings;
  if (!settings || typeof settings !== "object" || settings.v !== 5) bad("The settings are missing or from an older version of the page.");
  try { engine().build(settings); } catch (err) { bad("The calendar cannot be built from these settings: " + (err && err.message ? err.message : err)); }
  if (memberOf($app, e.auth.id)) bad("This account is already part of a shared calendar.");
  if (viewerOf($app, e.auth.id)) bad("This account views a calendar as a third party. A parent uses a different email address.");
  let out = null;
  $app.runInTransaction((tx) => {
    const fam = new Record(tx.findCollectionByNameOrId("families"));
    fam.set("code", freshCode(tx));
    fam.set("name", String(b.name || "").slice(0, 120));
    fam.set("settings", settings);
    fam.set("version", 1);
    fam.set("users", [e.auth.id]);
    tx.save(fam);
    const me = new Record(tx.findCollectionByNameOrId("members"));
    me.set("family", fam.id); me.set("user", e.auth.id); me.set("role", role); me.set("confirmed", true); me.set("feed_token", $security.randomString(40));
    tx.save(me);
    addEvent(tx, fam.id, me.id, "set up", String(b.summary || "Schedule entered").slice(0, 4000), null, 1);
    out = familyView(tx, fam, me);
  });
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---- join with the other parent's code ----
routerAdd("POST", "/api/cc/join", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, freshCode, allMembersOf, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView, viewerOf, requireParent, viewerText } = require(`${__hooks}/cc_lib.js`);
    const code = String(body(e).code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) bad("A code has 8 letters and digits.");
  const formatted = code.slice(0, 4) + "-" + code.slice(4);
  let fam = null;
  try { fam = $app.findFirstRecordByData("families", "code", formatted); } catch (_) {}
  if (!fam) {
    // not a parent code: a viewer invitation?
    let inv = null;
    try { inv = $app.findFirstRecordByData("viewers", "code", formatted); } catch (_) { bad("No calendar has that code. Check it with the person who gave it to you."); }
    if (inv.getString("status") !== "invited") bad(inv.getString("status") === "active" ? "That invitation was already used." : "That invitation was withdrawn by a parent.");
    if (memberOf($app, e.auth.id)) bad("This account is a parent on a shared calendar. A viewer uses a different email address.");
    if (viewerOf($app, e.auth.id)) bad("This account already views a calendar. Use a different email address for another one.");
    const f0 = $app.findRecordById("families", inv.getString("family"));
    let out = null;
    $app.runInTransaction((tx) => {
      const v = tx.findRecordById("viewers", inv.id);
      if (v.getString("status") !== "invited" || v.getString("user")) bad("That invitation was already used.");
      if (memberOf(tx, e.auth.id) || viewerOf(tx, e.auth.id)) bad("This account already has a calendar. Use a different email address for another one.");
      v.set("user", e.auth.id); v.set("status", "active"); v.set("activated", new Date().toISOString()); tx.save(v);
      const f = tx.findRecordById("families", f0.id);
      const us = (f.get("users") || []).filter((u) => u !== e.auth.id); us.push(e.auth.id); f.set("users", us); tx.save(f);
      addEvent(tx, f.id, null, "viewer joined", `${viewerText(jget(f, "settings"), v)} signed in and can now view the calendar and the record`, null, f.get("version"));
      out = familyView(tx, f, v);
    });
    for (const m of membersOf($app, f0.id)) sendMail(userEmail($app, m.getString("user")), "A viewer joined your Custody Calendar", `${viewerText(jget(f0, "settings"), inv)} signed in with ${e.auth.email()} and can now view the calendar, proposals and record. Either parent can end that access from the Linked parent page.`);
    return e.json(200, out);
  }
  if (viewerOf($app, e.auth.id)) bad("This account views a calendar as a third party. A parent uses a different email address.");
  const existing = memberOf($app, e.auth.id);
  if (existing && existing.getString("family") === fam.id) return e.json(200, familyView($app, fam, existing));
  if (existing) bad("This account is already part of another shared calendar.");
  const members = membersOf($app, fam.id);
  if (members.length >= 2) bad("That calendar already has both parents.");
  if (!members.length) bad("Nobody is on that calendar any more.");
  const role = members[0].getString("role") === "M" ? "F" : "M";
  let out = null;
  $app.runInTransaction((tx) => {
    if (membersOf(tx, fam.id).length >= 2) bad("That calendar already has both parents.");
    if (memberOf(tx, e.auth.id) || viewerOf(tx, e.auth.id)) bad("This account already has a calendar. Use a different email address for another one.");
    // a parent who left earlier leaves a row for this role; the new parent takes it over so the record stays whole
    const old = allMembersOf(tx, fam.id).find((m) => m.getString("role") === role);
    const me = old || new Record(tx.findCollectionByNameOrId("members"));
    me.set("family", fam.id); me.set("user", e.auth.id); me.set("role", role); me.set("confirmed", false); me.set("feed_token", $security.randomString(40)); me.set("left", false); me.set("left_at", "");
    tx.save(me);
    const f = tx.findRecordById("families", fam.id);
    const us = (f.get("users") || []).filter((u) => u !== e.auth.id); us.push(e.auth.id); f.set("users", us);
    tx.save(f);
    addEvent(tx, fam.id, me.id, "joined", `${parentName(jget(f, "settings"), role)} joined with the code`, null, f.get("version"));
    out = familyView(tx, f, me);
  });
  sendMail(userEmail($app, members[0].getString("user")), "The other parent joined your Custody Calendar", `${parentName(jget(fam, "settings"), role)} (${e.auth.email()}) joined the shared calendar. Until they confirm the schedule, it stays in force as it is.`);
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---- the joining parent confirms the schedule as it stands (it stays in force either way) ----
routerAdd("POST", "/api/cc/confirm", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, freshCode, allMembersOf, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView, viewerOf, requireParent, viewerText } = require(`${__hooks}/cc_lib.js`);
    const me = requireParent($app, e.auth.id);
  if (me.getBool("confirmed")) return e.json(200, familyView($app, $app.findRecordById("families", me.getString("family")), me));
  let out = null;
  $app.runInTransaction((tx) => {
    const m = tx.findRecordById("members", me.id);
    m.set("confirmed", true); tx.save(m);
    const fam = tx.findRecordById("families", m.getString("family"));
    const open = tx.findRecordsByFilter("proposals", "family = {:f} && unconfirmed = true", "created", 500, 0, { f: fam.id });
    for (const p of open) { p.set("unconfirmed", false); p.set("decided_by", m.id); p.set("decided_at", new Date().toISOString()); tx.save(p); }
    addEvent(tx, fam.id, m.id, "confirmed", `${parentName(jget(fam, "settings"), m.getString("role"))} confirmed the schedule as it stands` + (open.length ? `, including ${open.length} earlier change${open.length === 1 ? "" : "s"}` : ""), null, fam.get("version"));
    out = familyView(tx, fam, m);
  });
  const other = otherMember($app, me.getString("family"), me.id);
  if (other) sendMail(userEmail($app, other.getString("user")), "The schedule is confirmed", `${parentName(out.family.settings, me.getString("role"))} confirmed the shared calendar as it stands.`);
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---- propose a change ----
routerAdd("POST", "/api/cc/proposals", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, freshCode, allMembersOf, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView, viewerOf, requireParent, viewerText } = require(`${__hooks}/cc_lib.js`);
    const me = requireParent($app, e.auth.id);
  const b = body(e);
  const kind = String(b.kind || "");
  if (!["settings", "change", "vacation", "remove"].includes(kind)) bad("Unknown proposal kind.");
  const summary = String(b.summary || "").trim().slice(0, 2000);
  if (!summary) bad("The proposal needs a one-line summary.");
  const fam = $app.findRecordById("families", me.getString("family"));
  const applied = applyProposal(jget(fam, "settings"), kind, b.payload); // validates
  const members = membersOf($app, fam.id);
  const alone = members.length < 2;
  const myName = parentName(jget(fam, "settings"), me.getString("role"));
  let out = null;
  $app.runInTransaction((tx) => {
    const p = new Record(tx.findCollectionByNameOrId("proposals"));
    p.set("family", fam.id); p.set("kind", kind); p.set("payload", b.payload); p.set("summary", summary); p.set("note", String(b.note || "").slice(0, 2000));
    p.set("proposed_by", me.id); p.set("base_version", fam.get("version"));
    if (alone) {
      const f = tx.findRecordById("families", fam.id);
      const v = (f.get("version") || 1) + 1;
      f.set("settings", applied); f.set("version", v); tx.save(f);
      p.set("status", "approved"); p.set("unconfirmed", true); p.set("decided_at", new Date().toISOString()); tx.save(p);
      addEvent(tx, fam.id, me.id, "changed", `${myName}: ${summary} (applies now; not yet confirmed by the other parent)`, p.id, v);
      out = familyView(tx, f, me);
    } else {
      p.set("status", "open"); tx.save(p);
      addEvent(tx, fam.id, me.id, "proposed", `${myName}: ${summary}` + (p.getString("note") ? ` ("${p.getString("note")}")` : ""), p.id, fam.get("version"));
      out = familyView(tx, fam, me);
    }
    out.proposal_id = p.id;
  });
  if (!alone) {
    const other = members.find((m) => m.id !== me.id);
    sendMail(userEmail($app, other.getString("user")), `${myName} proposes a change to the calendar`, `${summary}` + (b.note ? `\nReason: ${b.note}` : "") + `\n\nNothing changes until you approve it. Open your dashboard to approve or decline.`);
  }
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---- approve, decline, withdraw (the logic is decide() in cc_lib.js) ----
routerAdd("POST", "/api/cc/proposals/{id}/approve", (e) => require(`${__hooks}/cc_lib.js`).decide(e, "approve"), $apis.requireAuth("users"));
routerAdd("POST", "/api/cc/proposals/{id}/decline", (e) => require(`${__hooks}/cc_lib.js`).decide(e, "decline"), $apis.requireAuth("users"));
routerAdd("POST", "/api/cc/proposals/{id}/withdraw", (e) => require(`${__hooks}/cc_lib.js`).decide(e, "withdraw"), $apis.requireAuth("users"));

// ---- calendar feed: a private address per parent; approved calendar only ----
routerAdd("GET", "/api/cc/feed/{token}", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, freshCode, allMembersOf, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView, viewerOf, requireParent, viewerText } = require(`${__hooks}/cc_lib.js`);
    const token = String(e.request.pathValue("token") || "").replace(/\.ics$/, "");
  if (token.length < 32) throw new NotFoundError("No calendar at this address.");
  let m = null;
  try { m = $app.findFirstRecordByData("members", "feed_token", token); } catch (_) {}
  if (!m) { try { const v = $app.findFirstRecordByData("viewers", "feed_token", token); if (v.getString("status") === "active") m = v; } catch (_) {} }
  if (!m) throw new NotFoundError("No calendar at this address.");
  const fam = $app.findRecordById("families", m.getString("family"));
  const s = jget(fam, "settings");
  const E = engine();
  const { result } = E.build(s);
  const text = E.icsText(result, { M: parentName(s, "M"), F: parentName(s, "F") }, { name: "Custody Calendar", refresh: "PT6H", S: s });
  e.response.header().set("Content-Type", "text/calendar; charset=utf-8");
  e.response.header().set("Cache-Control", "no-store");
  e.response.header().set("Content-Disposition", 'inline; filename="custody-calendar.ics"');
  return e.string(200, text);
});

routerAdd("POST", "/api/cc/feed/rotate", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, freshCode, allMembersOf, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView, viewerOf, requireParent, viewerText } = require(`${__hooks}/cc_lib.js`);
    const me = memberOf($app, e.auth.id) || viewerOf($app, e.auth.id);
  if (!me) bad("You are not part of a shared calendar.");
  me.set("feed_token", $security.randomString(40)); $app.save(me);
  const who = me.collection().name === "viewers" ? viewerText(jget($app.findRecordById("families", me.getString("family")), "settings"), me) : null;
  addEvent($app, me.getString("family"), who ? null : me.id, "feed address changed", (who ? who + ": a" : "A") + " new private calendar address was made; the old one stopped working", null, null);
  return e.json(200, { feed: me.getString("feed_token") });
}, $apis.requireAuth("users"));

// ---- published calendars (no account): a calendar-app address for the settings in a browser ----
routerAdd("POST", "/api/cc/publish", (e) => {
  const { jget, engine, bad, body } = require(`${__hooks}/cc_lib.js`);
  const b = body(e);
  const settings = b.settings;
  if (!settings || typeof settings !== "object" || settings.v !== 5) bad("The settings are missing or from an older version of the page.");
  try { engine().build(settings); } catch (err) { bad("The calendar cannot be built from these settings: " + (err && err.message ? err.message : err)); }
  let rec = null;
  if (b.id) {
    try { rec = $app.findRecordById("published", String(b.id)); } catch (_) { bad("That calendar address no longer exists. Make a new one."); }
    if (!b.secret || !$security.equal(rec.getString("secret"), String(b.secret))) bad("This browser cannot update that calendar address (the key does not match). Make a new one and replace it in your calendar app.");
  }
  if (rec) { rec.set("settings", settings); rec.set("version", (rec.get("version") || 1) + 1); $app.save(rec); }
  else { rec = new Record($app.findCollectionByNameOrId("published")); rec.set("settings", settings); rec.set("secret", $security.randomString(40)); rec.set("version", 1); $app.save(rec); }
  return e.json(200, { id: rec.id, secret: rec.getString("secret"), version: rec.get("version"), url: $app.settings().meta.appURL + "/api/cc/cal/" + rec.id + ".ics" });
});

routerAdd("GET", "/api/cc/cal/{id}", (e) => {
  const { jget, engine, parentName } = require(`${__hooks}/cc_lib.js`);
  const id = String(e.request.pathValue("id") || "").replace(/\.ics$/, "");
  let rec = null;
  try { rec = $app.findRecordById("published", id); } catch (_) { throw new NotFoundError("No calendar at this address."); }
  const s = jget(rec, "settings");
  // Remember use, at most once a day, so addresses nobody reads for 180 days can be removed.
  try { const last = rec.getString("fetched"); if (!last || Date.now() - new Date(last).getTime() > 86400000) { rec.set("fetched", new Date().toISOString()); $app.save(rec); } } catch (_) {}
  const E = engine();
  const { result } = E.build(s);
  const text = E.icsText(result, { M: parentName(s, "M"), F: parentName(s, "F") }, { name: "Custody Calendar", refresh: "PT6H", S: s });
  e.response.header().set("Content-Type", "text/calendar; charset=utf-8");
  e.response.header().set("Cache-Control", "no-store");
  e.response.header().set("Content-Disposition", 'inline; filename="custody-calendar.ics"');
  return e.string(200, text);
});

// Published addresses nobody has read for 180 days (or never read, 180 days after publishing) are removed nightly.
// The count removed is written to the server log, so the cut-off is visible.
cronAdd("published-cleanup", "20 4 * * *", () => {
  const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().replace("T", " ");
  const rows = $app.findRecordsByFilter("published", "(fetched != '' && fetched < {:c}) || (fetched = '' && created < {:c})", "", 500, 0, { c: cutoff });
  for (const r of rows) $app.delete(r);
  if (rows.length) console.log("published-cleanup removed " + rows.length + " calendar address(es) unused since " + cutoff);
});

// ---- third-party viewers: invite, revoke ----
routerAdd("POST", "/api/cc/viewers", (e) => {
  const { jget, bad, body, freshCode, parentName, requireParent, membersOf, otherMember, userEmail, addEvent, sendMail, familyView, viewerText } = require(`${__hooks}/cc_lib.js`);
  const me = requireParent($app, e.auth.id);
  const b = body(e);
  const label = ["attorney", "mediator", "gal", "other"].includes(b.label) ? b.label : bad("Say what kind of viewer this is.");
  const name = String(b.name || "").trim().slice(0, 120); if (!name) bad("Enter the viewer's name.");
  const forRole = b.for_role === "M" || b.for_role === "F" ? b.for_role : "";
  const fam = $app.findRecordById("families", me.getString("family"));
  const open = $app.findRecordsByFilter("viewers", "family = {:f} && status != 'revoked'", "created", 50, 0, { f: fam.id });
  if (open.length >= 10) bad("Ten viewers is the most one calendar can have; revoke one first.");
  let out = null;
  $app.runInTransaction((tx) => {
    const v = new Record(tx.findCollectionByNameOrId("viewers"));
    v.set("family", fam.id); v.set("label", label); v.set("name", name); if (forRole) v.set("for_role", forRole);
    v.set("invited_by", me.id); v.set("code", freshCode(tx)); v.set("status", "invited"); v.set("feed_token", $security.randomString(40));
    tx.save(v);
    addEvent(tx, fam.id, me.id, "viewer invited", `${parentName(jget(fam, "settings"), me.getString("role"))} invited ${viewerText(jget(fam, "settings"), v)} to view the calendar and the record`, null, fam.get("version"));
    out = familyView(tx, fam, me); out.viewer_id = v.id;
  });
  const other = otherMember($app, fam.id, me.id);
  if (other) sendMail(userEmail($app, other.getString("user")), "A viewer was invited to your Custody Calendar", `${parentName(jget(fam, "settings"), me.getString("role"))} invited ${name} (${label}) to view the calendar, proposals and record. Viewers cannot change anything. Either parent can end the access from the Linked parent page.`);
  return e.json(200, out);
}, $apis.requireAuth("users"));

routerAdd("POST", "/api/cc/viewers/{id}/revoke", (e) => {
  const { jget, bad, parentName, requireParent, membersOf, otherMember, userEmail, addEvent, sendMail, familyView, viewerText } = require(`${__hooks}/cc_lib.js`);
  const me = requireParent($app, e.auth.id);
  let v = null;
  try { v = $app.findRecordById("viewers", e.request.pathValue("id")); } catch (_) { bad("That viewer no longer exists."); }
  if (v.getString("family") !== me.getString("family")) bad("That viewer is not on your calendar.");
  if (v.getString("status") === "revoked") bad("That access was already ended.");
  const fam = $app.findRecordById("families", v.getString("family"));
  const s = jget(fam, "settings");
  let out = null;
  $app.runInTransaction((tx) => {
    const vv = tx.findRecordById("viewers", v.id);
    const was = vv.getString("status");
    vv.set("status", "revoked"); vv.set("revoked_by", me.id); vv.set("revoked_at", new Date().toISOString()); vv.set("feed_token", $security.randomString(40)); tx.save(vv);
    const f = tx.findRecordById("families", fam.id);
    const uid = vv.getString("user"); if (uid) { f.set("users", (f.get("users") || []).filter((u) => u !== uid)); tx.save(f); }
    addEvent(tx, f.id, me.id, was === "invited" ? "viewer invitation withdrawn" : "viewer access ended", `${parentName(s, me.getString("role"))} ${was === "invited" ? "withdrew the invitation for" : "ended the access of"} ${viewerText(s, vv)}`, null, f.get("version"));
    out = familyView(tx, f, me);
  });
  const other = otherMember($app, fam.id, me.id);
  const wasInvited = v.getString("status") === "invited";
  if (other) sendMail(userEmail($app, other.getString("user")), wasInvited ? "A viewer invitation for your Custody Calendar was withdrawn" : "A viewer's access to your Custody Calendar ended", wasInvited ? `${parentName(s, me.getString("role"))} withdrew the invitation for ${viewerText(s, v)}; they never had access.` : `${parentName(s, me.getString("role"))} ended the access of ${viewerText(s, v)}.`);
  if (v.getString("user")) sendMail(userEmail($app, v.getString("user")), "Your access to a Custody Calendar ended", `A parent ended your access to the shared calendar of ${parentName(s, "M")} and ${parentName(s, "F")}. The calendar address you may have added to a calendar app has stopped working.`);
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---- leave the shared calendar (the record stays with the family) ----
routerAdd("POST", "/api/cc/leave", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, freshCode, allMembersOf, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView, viewerOf, requireParent, viewerText } = require(`${__hooks}/cc_lib.js`);
    const me = requireParent($app, e.auth.id);
  const fam = $app.findRecordById("families", me.getString("family"));
  const myName = parentName(jget(fam, "settings"), me.getString("role"));
  const other = otherMember($app, fam.id, me.id);
  $app.runInTransaction((tx) => {
    const f = tx.findRecordById("families", fam.id);
    const open = tx.findRecordsByFilter("proposals", "family = {:f} && status = 'open' && proposed_by = {:m}", "created", 500, 0, { f: f.id, m: me.id });
    for (const pr of open) { pr.set("status", "withdrawn"); pr.set("decided_by", me.id); pr.set("decided_at", new Date().toISOString()); pr.set("decided_note", "withdrawn because the proposer left the calendar"); tx.save(pr); addEvent(tx, f.id, me.id, "withdrawn", `${myName} withdrew: ${pr.getString("summary")} (left the calendar)`, pr.id, f.get("version")); }
    addEvent(tx, f.id, me.id, "left", `${myName} left the shared calendar`, null, f.get("version"));
    f.set("users", (f.get("users") || []).filter((u) => u !== e.auth.id)); tx.save(f);
    const m = tx.findRecordById("members", me.id);
    m.set("left", true); m.set("left_at", new Date().toISOString()); m.set("feed_token", $security.randomString(40)); tx.save(m);
    if (!other) tx.delete(f); // nobody left: the calendar and its record go
  });
  if (other) sendMail(userEmail($app, other.getString("user")), `${myName} left the shared calendar`, `${myName} unlinked from the shared calendar. Your calendar and the record stay as they are.`);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
