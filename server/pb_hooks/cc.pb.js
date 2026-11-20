/// <reference path="../pb_data/types.d.ts" />
// Custody Calendar account routes. Every write to families, members, proposals and events goes through here, so the
// rules (who may approve, what a proposal may change, what the record says) live in one place and run on the server.
// Helpers are in cc_lib.js (required inside each handler: PocketBase gives every handler its own runtime).

// ---- sign in: make sure the account exists, then the client asks PocketBase for the one-time code ----
routerAdd("POST", "/api/cc/signin", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView } = require(`${__hooks}/cc_lib.js`);
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
  const { jget, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView } = require(`${__hooks}/cc_lib.js`);
    const me = memberOf($app, e.auth.id);
  if (!me) return e.json(200, { user: { id: e.auth.id, email: e.auth.email() }, family: null });
  const fam = $app.findRecordById("families", me.getString("family"));
  return e.json(200, Object.assign({ user: { id: e.auth.id, email: e.auth.email() } }, familyView($app, fam, me)));
}, $apis.requireAuth("users"));

// ---- start a shared calendar from the settings in this browser ----
routerAdd("POST", "/api/cc/families", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView } = require(`${__hooks}/cc_lib.js`);
    const b = body(e);
  const role = b.role === "F" ? "F" : b.role === "M" ? "M" : bad("Say which parent you are.");
  const settings = b.settings;
  if (!settings || typeof settings !== "object" || settings.v !== 5) bad("The settings are missing or from an older version of the page.");
  try { engine().build(settings); } catch (err) { bad("The calendar cannot be built from these settings: " + (err && err.message ? err.message : err)); }
  if (memberOf($app, e.auth.id)) bad("This account is already part of a shared calendar.");
  let out = null;
  $app.runInTransaction((tx) => {
    const fam = new Record(tx.findCollectionByNameOrId("families"));
    let code = newCode();
    for (let i = 0; i < 5; i++) { try { tx.findFirstRecordByData("families", "code", code); code = newCode(); } catch (_) { break; } }
    fam.set("code", code);
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
  const { jget, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView } = require(`${__hooks}/cc_lib.js`);
    const code = String(body(e).code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) bad("A code has 8 letters and digits.");
  const formatted = code.slice(0, 4) + "-" + code.slice(4);
  let fam = null;
  try { fam = $app.findFirstRecordByData("families", "code", formatted); } catch (_) { bad("No calendar has that code. Check it with the other parent."); }
  const existing = memberOf($app, e.auth.id);
  if (existing && existing.getString("family") === fam.id) return e.json(200, familyView($app, fam, existing));
  if (existing) bad("This account is already part of another shared calendar.");
  const members = membersOf($app, fam.id);
  if (members.length >= 2) bad("That calendar already has both parents.");
  const role = members[0].getString("role") === "M" ? "F" : "M";
  let out = null;
  $app.runInTransaction((tx) => {
    const me = new Record(tx.findCollectionByNameOrId("members"));
    me.set("family", fam.id); me.set("user", e.auth.id); me.set("role", role); me.set("confirmed", false); me.set("feed_token", $security.randomString(40));
    tx.save(me);
    const f = tx.findRecordById("families", fam.id);
    f.set("users", [members[0].getString("user"), e.auth.id]);
    tx.save(f);
    addEvent(tx, fam.id, me.id, "joined", `${parentName(jget(f, "settings"), role)} joined with the code`, null, f.get("version"));
    out = familyView(tx, f, me);
  });
  sendMail(userEmail($app, members[0].getString("user")), "The other parent joined your Custody Calendar", `${parentName(jget(fam, "settings"), role)} (${e.auth.email()}) joined the shared calendar. Until they confirm the schedule, it stays in force as it is.`);
  return e.json(200, out);
}, $apis.requireAuth("users"));

// ---- the joining parent confirms the schedule as it stands (it stays in force either way) ----
routerAdd("POST", "/api/cc/confirm", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView } = require(`${__hooks}/cc_lib.js`);
    const me = memberOf($app, e.auth.id);
  if (!me) bad("You are not part of a shared calendar.");
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
  const { jget, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView } = require(`${__hooks}/cc_lib.js`);
    const me = memberOf($app, e.auth.id);
  if (!me) bad("You are not part of a shared calendar.");
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
  const { jget, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView } = require(`${__hooks}/cc_lib.js`);
    const token = String(e.request.pathValue("token") || "").replace(/\.ics$/, "");
  if (token.length < 32) throw new NotFoundError("No calendar at this address.");
  let m = null;
  try { m = $app.findFirstRecordByData("members", "feed_token", token); } catch (_) { throw new NotFoundError("No calendar at this address."); }
  const fam = $app.findRecordById("families", m.getString("family"));
  const s = jget(fam, "settings");
  const E = engine();
  const { result } = E.build(s);
  const text = E.icsText(result, { M: parentName(s, "M"), F: parentName(s, "F") }, { name: "Custody Calendar", refresh: "PT6H" });
  e.response.header().set("Content-Type", "text/calendar; charset=utf-8");
  e.response.header().set("Cache-Control", "no-store");
  e.response.header().set("Content-Disposition", 'inline; filename="custody-calendar.ics"');
  return e.string(200, text);
});

routerAdd("POST", "/api/cc/feed/rotate", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView } = require(`${__hooks}/cc_lib.js`);
    const me = memberOf($app, e.auth.id);
  if (!me) bad("You are not part of a shared calendar.");
  me.set("feed_token", $security.randomString(40)); $app.save(me);
  addEvent($app, me.getString("family"), me.id, "feed address changed", "A new private calendar address was made; the old one stopped working", null, null);
  return e.json(200, { feed: me.getString("feed_token") });
}, $apis.requireAuth("users"));

// ---- leave the shared calendar (the record stays with the family) ----
routerAdd("POST", "/api/cc/leave", (e) => {
  const { jget, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, applyProposal, addEvent, sendMail, familyView } = require(`${__hooks}/cc_lib.js`);
    const me = memberOf($app, e.auth.id);
  if (!me) bad("You are not part of a shared calendar.");
  const fam = $app.findRecordById("families", me.getString("family"));
  const myName = parentName(jget(fam, "settings"), me.getString("role"));
  const other = otherMember($app, fam.id, me.id);
  $app.runInTransaction((tx) => {
    const f = tx.findRecordById("families", fam.id);
    addEvent(tx, f.id, me.id, "left", `${myName} left the shared calendar`, null, f.get("version"));
    f.set("users", (f.get("users") || []).filter((u) => u !== e.auth.id)); tx.save(f);
    tx.delete(tx.findRecordById("members", me.id));
    if (!other) tx.delete(f); // nobody left: the calendar and its record go
  });
  if (other) sendMail(userEmail($app, other.getString("user")), `${myName} left the shared calendar`, `${myName} unlinked from the shared calendar. Your calendar and the record stay as they are.`);
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
