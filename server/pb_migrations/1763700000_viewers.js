/// <reference path="../pb_data/types.d.ts" />
// Third-party viewers (attorney, mediator, guardian ad litem): read-only access to one family's calendar, proposals
// and record. A parent invites a viewer by code; the viewer signs in with their own email like a parent. Access is
// granted by listing the viewer's user on families.users (the read rules already key on it) and ends when a
// parent revokes, which removes the user from that list again.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const families = app.findCollectionByNameOrId("families");
  const members = app.findCollectionByNameOrId("members");

  // Up to two parents plus viewers.
  const fu = families.fields.getByName("users");
  fu.maxSelect = 12;
  app.save(families);

  // Feed tokens never leave the server through the record API; the routes hand each account its own.
  const mf = members.fields.getByName("feed_token");
  mf.hidden = true;
  app.save(members);

  const viewers = new Collection({
    name: "viewers",
    type: "base",
    fields: [
      { name: "family", type: "relation", collectionId: families.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "label", type: "select", required: true, values: ["attorney", "mediator", "gal", "other"], maxSelect: 1 },
      { name: "name", type: "text", required: true, min: 1, max: 120 },
      { name: "for_role", type: "select", values: ["M", "F"], maxSelect: 1 },
      { name: "invited_by", type: "relation", collectionId: members.id, required: true, maxSelect: 1 },
      { name: "code", type: "text", required: true, min: 9, max: 9, pattern: "^[A-Z0-9]{4}-[A-Z0-9]{4}$" },
      { name: "status", type: "select", required: true, values: ["invited", "active", "revoked"], maxSelect: 1 },
      { name: "feed_token", type: "text", required: true, min: 32, max: 64, hidden: true },
      { name: "revoked_by", type: "relation", collectionId: members.id, maxSelect: 1 },
      { name: "activated", type: "date" },
      { name: "revoked_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_viewers_code ON viewers (code)",
      "CREATE UNIQUE INDEX idx_viewers_feed ON viewers (feed_token)",
      "CREATE INDEX idx_viewers_family ON viewers (family, status)",
    ],
    listRule: "family.users.id ?= @request.auth.id",
    viewRule: "family.users.id ?= @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(viewers);

  // Calendars published without an account: a short address for calendar apps, updated by whoever holds the secret.
  const published = new Collection({
    name: "published",
    type: "base",
    fields: [
      { name: "settings", type: "json", required: true, maxSize: 400000 },
      { name: "secret", type: "text", required: true, min: 32, max: 64, hidden: true },
      { name: "version", type: "number", required: true, min: 1, onlyInt: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  });
  app.save(published);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("published")); } catch (_) {}
  try { app.delete(app.findCollectionByNameOrId("viewers")); } catch (_) {}
  const families = app.findCollectionByNameOrId("families");
  families.fields.getByName("users").maxSelect = 2;
  app.save(families);
  const members = app.findCollectionByNameOrId("members");
  members.fields.getByName("feed_token").hidden = false;
  app.save(members);
});
