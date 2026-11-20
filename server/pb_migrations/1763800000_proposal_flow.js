/// <reference path="../pb_data/types.d.ts" />
// Proposal flow: counter-offers (a proposal that replaces another), care requests (first option to care, plan II.I),
// and answer-by dates with a reminder and automatic expiry.
migrate((app) => {
  const proposals = app.findCollectionByNameOrId("proposals");
  proposals.fields.getByName("kind").values = ["settings", "change", "vacation", "remove", "care"];
  proposals.fields.getByName("status").values = ["open", "approved", "declined", "withdrawn", "countered", "expired"];
  proposals.fields.add(new DateField({ name: "answer_by" }));
  proposals.fields.add(new BoolField({ name: "reminded" }));
  proposals.fields.add(new RelationField({ name: "replaces", collectionId: proposals.id, maxSelect: 1 }));
  app.save(proposals);
}, (app) => {
  const proposals = app.findCollectionByNameOrId("proposals");
  for (const n of ["answer_by", "reminded", "replaces"]) proposals.fields.removeByName(n);
  proposals.fields.getByName("kind").values = ["settings", "change", "vacation", "remove"];
  proposals.fields.getByName("status").values = ["open", "approved", "declined", "withdrawn"];
  app.save(proposals);
});
