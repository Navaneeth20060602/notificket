/*
  Warnings:

  - A unique constraint covering the columns `[movieId,theatreId,formatId,date,time,platform]` on the table `Showtime` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Showtime_movieId_theatreId_formatId_date_time_key";

-- AlterTable
ALTER TABLE "Showtime" ADD COLUMN "language" TEXT;
ALTER TABLE "Showtime" ADD COLUMN "platform" TEXT DEFAULT 'BMS';

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Request" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "locationId" TEXT,
    "theatreId" TEXT,
    "formatId" TEXT,
    "date" DATETIME,
    "timeFrom" TEXT,
    "timeTo" TEXT,
    "maxPrice" REAL,
    "theatreIds" TEXT NOT NULL DEFAULT '[]',
    "formatIds" TEXT NOT NULL DEFAULT '[]',
    "languages" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "preRelease" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Request_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Request_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Request_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Request_theatreId_fkey" FOREIGN KEY ("theatreId") REFERENCES "Theatre" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Request_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "Format" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Request" ("createdAt", "date", "formatId", "formatIds", "id", "languages", "locationId", "maxPrice", "movieId", "status", "theatreId", "theatreIds", "timeFrom", "timeTo", "updatedAt", "userId") SELECT "createdAt", "date", "formatId", "formatIds", "id", "languages", "locationId", "maxPrice", "movieId", "status", "theatreId", "theatreIds", "timeFrom", "timeTo", "updatedAt", "userId" FROM "Request";
DROP TABLE "Request";
ALTER TABLE "new_Request" RENAME TO "Request";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Showtime_movieId_theatreId_formatId_date_time_platform_key" ON "Showtime"("movieId", "theatreId", "formatId", "date", "time", "platform");
