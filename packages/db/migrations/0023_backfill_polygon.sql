INSERT INTO "app"."wallet_addresses" ("id", "investment_wallet_id", "chain_family", "chain", "address", "status", "verification_method", "verified_on_chain", "verification_challenge_id", "verified_at", "signable_chains", "created_at")
SELECT gen_random_uuid(), w."investment_wallet_id", w."chain_family", 'polygon', w."address", 'active', w."verification_method", w."verified_on_chain", w."verification_challenge_id", w."verified_at", w."signable_chains", now()
FROM (SELECT DISTINCT ON ("investment_wallet_id", "address") * FROM "app"."wallet_addresses"
      WHERE "chain_family" = 'evm' AND "verification_method" = 'eoa_ecdsa' AND "status" = 'active'
      ORDER BY "investment_wallet_id", "address", "created_at") w
ON CONFLICT DO NOTHING;
