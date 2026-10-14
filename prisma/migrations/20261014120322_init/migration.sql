-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('men', 'women');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "MovementReason" AS ENUM ('sale', 'restock', 'adjustment', 'return');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('percent', 'fixed', 'free_delivery', 'bogo');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('draft', 'active', 'paused');

-- CreateEnum
CREATE TYPE "PromotionTargetType" AS ENUM ('all', 'category', 'product');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "FulfilmentMethod" AS ENUM ('delivery', 'pickup');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('mpesa', 'airtel', 'card', 'cod');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('hero', 'banner', 'testimonial_set', 'category_tiles', 'rich_text', 'faq', 'gift_promo');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('active', 'disabled');

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "alt" TEXT NOT NULL DEFAULT '',
    "uploadedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "gender" "Gender" NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "imageId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "parentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colours" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "categoryId" UUID NOT NULL,
    "blurb" TEXT NOT NULL DEFAULT '',
    "basePrice" INTEGER NOT NULL,
    "compareAtPrice" INTEGER,
    "status" "ProductStatus" NOT NULL DEFAULT 'draft',
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "isBestseller" BOOLEAN NOT NULL DEFAULT false,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "soldCount" INTEGER NOT NULL DEFAULT 0,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_colours" (
    "productId" UUID NOT NULL,
    "colourId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_colours_pkey" PRIMARY KEY ("productId","colourId")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "colourId" UUID,
    "mediaId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "alt" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variants" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "colourId" UUID NOT NULL,
    "size" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "priceOverride" INTEGER,
    "barcode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "variantId" UUID NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "MovementReason" NOT NULL,
    "ref" TEXT,
    "note" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" "PromotionType" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "status" "PromotionStatus" NOT NULL DEFAULT 'draft',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "perCustomerLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "minSubtotal" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_targets" (
    "id" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "targetType" "PromotionTargetType" NOT NULL,
    "targetId" UUID,

    CONSTRAINT "promotion_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "customerRef" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "number" TEXT,
    "customerId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "method" "FulfilmentMethod" NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "deliveryFee" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "paymentMethod" "PaymentProvider" NOT NULL,
    "county" TEXT,
    "address" TEXT,
    "eta" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "stockCommitted" BOOLEAN NOT NULL DEFAULT false,
    "reservationExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "colourSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "gift" JSONB,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "amount" INTEGER NOT NULL,
    "providerRef" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" UUID,
    "note" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "counties" TEXT[],
    "fee" INTEGER NOT NULL,
    "etaDays" INTEGER NOT NULL DEFAULT 2,
    "eta" TEXT NOT NULL DEFAULT '',
    "freeOver" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_blocks" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "gender" "Gender",
    "data" JSONB NOT NULL DEFAULT '{}',
    "draftData" JSONB,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "publishAt" TIMESTAMP(3),
    "unpublishAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_block_versions" (
    "id" UUID NOT NULL,
    "blockId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_block_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "quote" TEXT NOT NULL,
    "avatarMediaId" UUID,
    "rating" INTEGER NOT NULL DEFAULT 5,
    "gender" "Gender",
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "status" "StaffStatus" NOT NULL DEFAULT 'active',
    "lastLoginAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_key_key" ON "media"("key");

-- CreateIndex
CREATE UNIQUE INDEX "categories_gender_slug_key" ON "categories"("gender", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "colours_name_key" ON "colours"("name");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_status_categoryId_gender_idx" ON "products"("status", "categoryId", "gender");

-- CreateIndex
CREATE INDEX "products_deletedAt_idx" ON "products"("deletedAt");

-- CreateIndex
CREATE INDEX "product_images_productId_colourId_position_idx" ON "product_images"("productId", "colourId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "variants_sku_key" ON "variants"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "variants_productId_colourId_size_key" ON "variants"("productId", "colourId", "size");

-- CreateIndex
CREATE INDEX "inventory_movements_variantId_createdAt_idx" ON "inventory_movements"("variantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE INDEX "promotions_status_startsAt_endsAt_idx" ON "promotions"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "promotion_targets_promotionId_idx" ON "promotion_targets"("promotionId");

-- CreateIndex
CREATE INDEX "promotion_redemptions_promotionId_customerRef_idx" ON "promotion_redemptions"("promotionId", "customerRef");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "orders_seq_key" ON "orders"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "order_lines_orderId_idx" ON "order_lines"("orderId");

-- CreateIndex
CREATE INDEX "order_lines_variantId_idx" ON "order_lines"("variantId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "order_events_orderId_createdAt_idx" ON "order_events"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_code_key" ON "delivery_zones"("code");

-- CreateIndex
CREATE UNIQUE INDEX "content_blocks_key_key" ON "content_blocks"("key");

-- CreateIndex
CREATE INDEX "content_blocks_kind_gender_status_idx" ON "content_blocks"("kind", "gender", "status");

-- CreateIndex
CREATE UNIQUE INDEX "content_block_versions_blockId_version_key" ON "content_block_versions"("blockId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "pages_slug_key" ON "pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_staffId_idx" ON "refresh_tokens"("staffId");

-- CreateIndex
CREATE INDEX "audit_log_entity_entityId_idx" ON "audit_log"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_colours" ADD CONSTRAINT "product_colours_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_colours" ADD CONSTRAINT "product_colours_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "colours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "colours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variants" ADD CONSTRAINT "variants_colourId_fkey" FOREIGN KEY ("colourId") REFERENCES "colours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_block_versions" ADD CONSTRAINT "content_block_versions_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "content_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "testimonials" ADD CONSTRAINT "testimonials_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written integrity constraints (not expressible in Prisma schema)
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_on_hand_nonneg" CHECK ("onHand" >= 0);
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_reserved_nonneg" CHECK ("reserved" >= 0);
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_reserved_lte_on_hand" CHECK ("reserved" <= "onHand");
ALTER TABLE "products" ADD CONSTRAINT "products_price_nonneg" CHECK ("basePrice" >= 0);
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_qty_positive" CHECK ("qty" > 0);
