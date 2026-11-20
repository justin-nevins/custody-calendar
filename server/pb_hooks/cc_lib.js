/// <reference path="../pb_data/types.d.ts" />
// Shared helpers for cc.pb.js. PocketBase runs every route handler in its own JS runtime, so helpers live in a
// module that each handler requires; top-level functions of a *.pb.js file are not visible inside handlers.
// Custody Calendar account routes. Every write to families, members, proposals and events goes through here, so the
// rules (who may approve, what a proposal may change, what the record says) live in one place and run on the server.
// The schedule engine is the same file the page uses (engine.js, copied next to this file by the deploy).

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I

function engine() { return require(`${__hooks}/engine.js`); }

function bad(msg, code) { throw new BadRequestError(msg || "Bad request", code ? { code } : undefined); }

function emailOk(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254; }

function body(e) { return e.requestInfo().body || {}; }

function newCode() {
  const a = $security.randomStringWithAlphabet(4, CODE_ALPHABET), b = $security.randomStringWithAlphabet(4, CODE_ALPHABET);
  return `${a}-${b}`;
}

function parentName(settings, role) {
  const p = settings && settings.parents && settings.parents[role];
  return (p && p.name) || (role === "M" ? "Mother" : "Father");
}

function memberOf(app, userId) {
  const rows = app.findRecordsByFilter("members", "user = {:u}", "-created", 1, 0, { u: userId });
  return rows.length ? rows[0] : null;
}

// The active viewer row (attorney, mediator) for a user, or null.
function viewerOf(app, userId) {
  const rows = app.findRecordsByFilter("viewers", "user = {:u} && status = 'active'", "-created", 1, 0, { u: userId });
  return rows.length ? rows[0] : null;
}
// Routes that change the shared calendar need a parent; a viewer gets a plain refusal, anyone else the usual one.
function requireParent(app, userId) {
  const me = memberOf(app, userId);
  if (me) return me;
  if (viewerOf(app, userId)) bad("This account has read-only access. A parent has to make this change.");
  bad("You are not part of a shared calendar.");
}
function isViewer(rec) { return !!rec && rec.collection().name === "viewers"; }
const LABELS = { attorney: "attorney", mediator: "mediator", gal: "guardian ad litem", other: "third party" };
function viewerText(settings, v) { const who = v.getString("for_role"); return `${v.getString("name")} (${LABELS[v.getString("label")] || v.getString("label")}${who ? ` for ${parentName(settings, who)}` : ""})`; }
function membersOf(app, familyId) {
  return app.findRecordsByFilter("members", "family = {:f}", "created", 10, 0, { f: familyId });
}

function otherMember(app, familyId, memberId) {
  return membersOf(app, familyId).find((m) => m.id !== memberId) || null;
}

function userEmail(app, userId) {
  try { return app.findRecordById("users", userId).email(); } catch (_) { return null; }
}

// Clone through JSON so a stored settings object is never mutated in place.
function clone(x) { return JSON.parse(JSON.stringify(x)); }
// JSON fields come out of a record as raw bytes in the hooks runtime; read them as text and parse.
function jget(rec, field) { const t = rec.getString(field); return t ? JSON.parse(t) : null; }

// Apply a proposal with the shared engine function; its plain-sentence errors become 400 responses.
function applyProposal(settings, kind, payload) {
  try { return engine().applyProposal(settings, kind, payload); } catch (err) { bad(err && err.message ? err.message : String(err)); }
}

function addEvent(app, familyId, actorId, action, detail, proposalId, version) {
  const r = new Record(app.findCollectionByNameOrId("events"));
  r.set("family", familyId);
  if (actorId) r.set("actor", actorId);
  r.set("action", action);
  r.set("detail", detail || "");
  if (proposalId) r.set("proposal", proposalId);
  if (version) r.set("version", version);
  app.save(r);
  return r;
}

function sendMail(to, subject, text) {
  if (!to) return;
  try {
    const meta = $app.settings().meta;
    const html = "<p>" + text.split("\n").map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("</p><p>") + "</p>" +
      '<p><a href="' + meta.appURL + '/#acct">Open Custody Calendar</a></p>';
    const m = new MailerMessage({ from: { address: meta.senderAddress, name: meta.senderName }, to: [{ address: to }], subject, html, text: text + "\n\n" + meta.appURL + "/#acct" });
    $app.newMailClient().send(m);
  } catch (err) {
    console.log("mail not sent to " + to + ": " + (err && err.message ? err.message : err));
  }
}

function familyView(app, fam, me) {
  const viewer = isViewer(me);
  const members = membersOf(app, fam.id).map((m) => ({ id: m.id, role: m.getString("role"), confirmed: m.getBool("confirmed"), email: viewer ? undefined : userEmail(app, m.getString("user")), me: !viewer && m.id === me.id }));
  const settings = jget(fam, "settings");
  const viewers = app.findRecordsByFilter("viewers", "family = {:f}", "created", 50, 0, { f: fam.id }).map((v) => ({ id: v.id, label: v.getString("label"), name: v.getString("name"), for_role: v.getString("for_role"), status: v.getString("status"), invited_by: v.getString("invited_by"), code: !viewer && v.getString("status") === "invited" ? v.getString("code") : undefined, email: v.getString("user") && !viewer ? userEmail(app, v.getString("user")) : undefined, created: v.getString("created"), activated: v.getString("activated"), revoked_at: v.getString("revoked_at"), me: viewer && v.id === me.id }));
  const proposals = app.findRecordsByFilter("proposals", "family = {:f}", "-created", 200, 0, { f: fam.id }).map((p) => ({
    id: p.id, kind: p.getString("kind"), payload: jget(p, "payload"), summary: p.getString("summary"), note: p.getString("note"), proposed_by: p.getString("proposed_by"),
    status: p.getString("status"), unconfirmed: p.getBool("unconfirmed"), decided_by: p.getString("decided_by"), decided_note: p.getString("decided_note"), decided_at: p.getString("decided_at"), created: p.getString("created"),
  }));
  const events = app.findRecordsByFilter("events", "family = {:f}", "-at", 300, 0, { f: fam.id }).map((ev) => ({ id: ev.id, at: ev.getString("at"), actor: ev.getString("actor"), action: ev.getString("action"), detail: ev.getString("detail"), proposal: ev.getString("proposal"), version: ev.get("version") }));
  const meOut = viewer ? { viewer: true, id: me.id, label: me.getString("label"), name: me.getString("name"), for_role: me.getString("for_role"), feed: me.getString("feed_token") } : { id: me.id, role: me.getString("role"), confirmed: me.getBool("confirmed"), feed: me.getString("feed_token") };
  return { readonly: viewer, family: { id: fam.id, code: viewer ? undefined : fam.getString("code"), settings, version: fam.get("version"), updated: fam.getString("updated") }, me: meOut, members, viewers, proposals, events };
}


// approve, decline or withdraw an open proposal
// ---- approve, decline, withdraw ----
function decide(e, action) {
  const me = requireParent($app, e.auth.id);
  const id = e.request.pathValue("id");
  let p = null;
  try { p = $app.findRecordById("proposals", id); } catch (_) { bad("That proposal no longer exists."); }
  if (p.getString("family") !== me.getString("family")) bad("That proposal is not on your calendar.");
  if (p.getString("status") !== "open") bad(`That proposal is already ${p.getString("status")}.`);
  const mine = p.getString("proposed_by") === me.id;
  if (action === "withdraw" && !mine) bad("Only the parent who proposed it can withdraw it.");
  if (action !== "withdraw" && mine) bad("The other parent decides on your proposal.");
  const note = String(body(e).note || "").trim().slice(0, 2000);
  if (action === "decline" && !note) bad("Give a one-line reason so the other parent knows why.");
  const fam = $app.findRecordById("families", p.getString("family"));
  const myName = parentName(jget(fam, "settings"), me.getString("role"));
  let out = null;
  $app.runInTransaction((tx) => {
    const f = tx.findRecordById("families", fam.id);
    const pr = tx.findRecordById("proposals", p.id);
    pr.set("decided_by", me.id); pr.set("decided_at", new Date().toISOString()); pr.set("decided_note", note);
    if (action === "approve") {
      const applied = applyProposal(jget(f, "settings"), pr.getString("kind"), jget(pr, "payload"));
      const v = (f.get("version") || 1) + 1;
      f.set("settings", applied); f.set("version", v); tx.save(f);
      pr.set("status", "approved"); tx.save(pr);
      addEvent(tx, f.id, me.id, "approved", `${myName} approved: ${pr.getString("summary")}` + (note ? ` ("${note}")` : ""), pr.id, v);
    } else if (action === "decline") {
      pr.set("status", "declined"); tx.save(pr);
      addEvent(tx, f.id, me.id, "declined", `${myName} declined: ${pr.getString("summary")} ("${note}")`, pr.id, f.get("version"));
    } else {
      pr.set("status", "withdrawn"); tx.save(pr);
      addEvent(tx, f.id, me.id, "withdrawn", `${myName} withdrew: ${pr.getString("summary")}` + (note ? ` ("${note}")` : ""), pr.id, f.get("version"));
    }
    out = familyView(tx, f, me);
  });
  const other = otherMember($app, fam.id, me.id);
  if (other) {
    const verb = action === "approve" ? "approved" : action === "decline" ? "declined" : "withdrew";
    sendMail(userEmail($app, other.getString("user")), `${myName} ${verb}: ${p.getString("summary")}`, `${myName} ${verb} the proposal "${p.getString("summary")}".` + (note ? `\nNote: ${note}` : "") + (action === "approve" ? "\n\nBoth calendars now show the change." : ""));
  }
  return e.json(200, out);
}

module.exports = { decide, viewerOf, requireParent, isViewer, viewerText, LABELS, jget, CODE_ALPHABET, engine, bad, emailOk, body, newCode, parentName, memberOf, membersOf, otherMember, userEmail, clone, applyProposal, addEvent, sendMail, familyView };
