-- The layer decomposition step of an ambient pack (SPEC.md §8.2): one cheap structured call
-- that turns "a rainy dockside at night" into continuous, oneshot and interval layers.
--
-- Priced at zero deliberately. What SPEC.md §8.1 anchors a cost to is the generation of each
-- resulting layer, 3 credits per layer, because that is the line item that can explode: three
-- to ten seconds of provider time each, against a service with three concurrent requests.
-- Charging separately for the sentence that decides how many layers there will be would
-- double-bill the same decision and make a two-layer pack cost more per layer than a
-- five-layer one. Free to the user, still recorded in model_call at its real cost to us,
-- which is the rule H1 set.
INSERT INTO "operation_price" ("operation", "label", "credits", "kind", "notes")
VALUES (
	'audio.layers_parse',
	'Ambient layer decomposition',
	0,
	'generation',
	'Free to the user: only the generation of each resulting layer is priced (audio.layer, 3 credits per layer, SPEC.md §8.1). Kind is generation rather than reading because a model does write something here, it just is not what gets billed.'
)
ON CONFLICT ("operation") DO NOTHING;
