/// <reference path="../pb_data/types.d.ts" />
// Parent accounts: families, members, proposals and the append-only record.
// Writes happen only through the routes in pb_hooks/cc.pb.js; the API rules below give parents read access to
// their own family and let nobody write records directly.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.passwordAuth.enabled = false;
  users.otp.enabled = true;
  users.otp.duration = 900; // 15 minutes
  users.otp.length = 8;
  users.otp.emailTemplate.subject = "Your sign-in link for Custody Calendar";
  users.otp.emailTemplate.body =
    '<p>Hello,</p>' +
    '<p><a href="{APP_URL}/#otp={OTP_ID}.{OTP}">Open Custody Calendar signed in</a></p>' +
    '<p>If the link does not open on this device, enter this code on the sign-in page: <strong>{OTP}</strong></p>' +
    '<p>The link and the code work for 15 minutes and once only. If you did not ask for this, nothing happens: ignore this email.</p>' +
    '<p>{APP_NAME}</p>';
  users.createRule = null;
  users.listRule = "id = @request.auth.id";
  users.viewRule = "id = @request.auth.id";
  users.updateRule = "id = @request.auth.id";
  users.deleteRule = null;
  app.save(users);

  const families = new Collection({
    name: "families",
    type: "base",
    fields: [
      { name: "name", type: "text", max: 120 },
      { name: "code", type: "text", required: true, min: 9, max: 9, pattern: "^[A-Z0-9]{4}-[A-Z0-9]{4}$" },
      { name: "settings", type: "json", required: true, maxSize: 400000 },
      { name: "version", type: "number", required: true, min: 1, onlyInt: true },
      { name: "users", type: "relation", collectionId: users.id, maxSelect: 2, cascadeDelete: false },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_families_code ON families (code)"],
    listRule: "users.id ?= @request.auth.id",
    viewRule: "users.id ?= @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(families);

  const members = new Collection({
    name: "members",
    type: "base",
    fields: [
      { name: "family", type: "relation", collectionId: families.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "user", type: "relation", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "role", type: "select", required: true, values: ["M", "F"], maxSelect: 1 },
      { name: "confirmed", type: "bool" },
      { name: "feed_token", type: "text", required: true, min: 32, max: 64 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_members_family_role ON members (family, role)",
      "CREATE UNIQUE INDEX idx_members_family_user ON members (family, user)",
      "CREATE UNIQUE INDEX idx_members_feed ON members (feed_token)",
    ],
    listRule: "family.users.id ?= @request.auth.id",
    viewRule: "family.users.id ?= @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(members);

  const proposals = new Collection({
    name: "proposals",
    type: "base",
    fields: [
      { name: "family", type: "relation", collectionId: families.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "kind", type: "select", required: true, values: ["settings", "change", "vacation", "remove"], maxSelect: 1 },
      { name: "payload", type: "json", required: true, maxSize: 400000 },
      { name: "summary", type: "text", required: true, max: 2000 },
      { name: "note", type: "text", max: 2000 },
      { name: "proposed_by", type: "relation", collectionId: members.id, required: true, maxSelect: 1 },
      { name: "status", type: "select", required: true, values: ["open", "approved", "declined", "withdrawn"], maxSelect: 1 },
      { name: "unconfirmed", type: "bool" },
      { name: "decided_by", type: "relation", collectionId: members.id, maxSelect: 1 },
      { name: "decided_note", type: "text", max: 2000 },
      { name: "decided_at", type: "date" },
      { name: "base_version", type: "number", onlyInt: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_proposals_family_status ON proposals (family, status)"],
    listRule: "family.users.id ?= @request.auth.id",
    viewRule: "family.users.id ?= @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(proposals);

  const events = new Collection({
    name: "events",
    type: "base",
    fields: [
      { name: "family", type: "relation", collectionId: families.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "actor", type: "relation", collectionId: members.id, maxSelect: 1 },
      { name: "action", type: "text", required: true, max: 80 },
      { name: "detail", type: "text", max: 4000 },
      { name: "proposal", type: "relation", collectionId: proposals.id, maxSelect: 1 },
      { name: "version", type: "number", onlyInt: true },
      { name: "at", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX idx_events_family_at ON events (family, at)"],
    listRule: "family.users.id ?= @request.auth.id",
    viewRule: "family.users.id ?= @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(events);

  const settings = app.settings();
  settings.meta.appName = "Custody Calendar";
  settings.meta.appURL = "https://custody-calendar.com";
  settings.meta.senderName = "Custody Calendar";
  settings.meta.senderAddress = "noreply@custody-calendar.com";
  settings.meta.hideControls = false;
  // Sign-in requests and the account routes are limited per client IP; the limit shows as HTTP 429.
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    { label: "POST /api/cc/signin", maxRequests: 5, duration: 60 },
    { label: "*:requestOTP", maxRequests: 5, duration: 60 },
    { label: "*:authWithOTP", maxRequests: 10, duration: 60 },
    { label: "/api/cc/", maxRequests: 120, duration: 60 },
  ];
  app.save(settings);
}, (app) => {
  for (const name of ["events", "proposals", "members", "families"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) {}
  }
  const users = app.findCollectionByNameOrId("users");
  users.passwordAuth.enabled = true;
  users.otp.enabled = false;
  app.save(users);
});
