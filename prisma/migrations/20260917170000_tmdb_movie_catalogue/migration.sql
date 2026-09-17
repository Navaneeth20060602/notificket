ALTER TABLE "Movie" ADD COLUMN "tmdbId" INTEGER;
CREATE UNIQUE INDEX "Movie_tmdbId_key" ON "Movie"("tmdbId");
