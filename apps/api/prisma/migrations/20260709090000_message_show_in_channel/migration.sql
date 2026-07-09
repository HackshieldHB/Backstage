-- Thread replies flagged "also send to channel" appear in the main channel view too.
ALTER TABLE "Message" ADD COLUMN "showInChannel" BOOLEAN NOT NULL DEFAULT false;
