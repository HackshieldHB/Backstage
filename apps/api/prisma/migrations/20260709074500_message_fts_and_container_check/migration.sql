-- Full-text search on Message.contentText.
-- Hand-written: the tsvector column is maintained by a trigger (Prisma cannot express
-- generated columns or triggers), and GIN-indexed for fast @@ queries.
ALTER TABLE "Message" ADD COLUMN "searchVector" tsvector;

CREATE FUNCTION message_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" := to_tsvector('english', coalesce(NEW."contentText", ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "contentText" ON "Message"
  FOR EACH ROW EXECUTE FUNCTION message_search_vector_update();

CREATE INDEX "Message_searchVector_idx" ON "Message" USING GIN ("searchVector");

-- A message lives in exactly one container: a channel XOR a conversation.
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_container_check"
  CHECK ((("channelId" IS NOT NULL)::int + ("conversationId" IS NOT NULL)::int) = 1);
