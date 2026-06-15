-- Track the single automatic discount that backs all BundleKit offers
ALTER TABLE "Shop" ADD COLUMN "automaticDiscountGid" TEXT;
