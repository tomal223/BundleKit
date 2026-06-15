-- Cache of expanded target product GIDs for storefront offer filtering
ALTER TABLE "Offer" ADD COLUMN "expandedTargetIds" TEXT NOT NULL DEFAULT '[]';
