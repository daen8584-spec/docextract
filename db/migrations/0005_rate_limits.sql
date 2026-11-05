CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limits_updated_at_idx" ON "rate_limits" USING btree ("updated_at");--> statement-breakpoint
-- Token bucket: takes one token from the bucket for p_key if one is available.
-- Tokens refill continuously at p_refill_per_second up to p_capacity. The row lock
-- makes concurrent requests for the same key consume tokens one at a time, so the
-- limit holds across any number of application instances.
CREATE FUNCTION "rate_limit_take"(p_key text, p_capacity double precision, p_refill_per_second double precision)
RETURNS TABLE ("allowed" boolean, "retry_after_ms" integer)
LANGUAGE plpgsql
AS $$
DECLARE
	available double precision;
BEGIN
	INSERT INTO rate_limits (key, tokens, updated_at) VALUES (p_key, p_capacity, clock_timestamp())
	ON CONFLICT (key) DO NOTHING;

	SELECT least(p_capacity, r.tokens + extract(epoch FROM clock_timestamp() - r.updated_at) * p_refill_per_second)
	INTO available
	FROM rate_limits r
	WHERE r.key = p_key
	FOR UPDATE;

	IF available >= 1 THEN
		UPDATE rate_limits SET tokens = available - 1, updated_at = clock_timestamp() WHERE key = p_key;
		RETURN QUERY SELECT true, 0;
	ELSE
		UPDATE rate_limits SET tokens = available, updated_at = clock_timestamp() WHERE key = p_key;
		RETURN QUERY SELECT false, ceil((1 - available) / p_refill_per_second * 1000)::integer;
	END IF;
END;
$$;
