/**
 * Shopify metafield read/write for offer sync.
 *
 * Offers are mirrored to an app-reserved shop metafield ($app:bundlekit/offers)
 * that the discount Function reads at checkout. App-reserved namespaces cannot
 * be written by other apps or the merchant — only BundleKit controls it.
 */

export const METAFIELD_NAMESPACE = "$app:bundlekit";
export const METAFIELD_KEY = "offers";
export const METAFIELD_PAYLOAD_VERSION = 1;

/** Minimal interface of the authenticated Admin GraphQL client. */
export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

const SHOP_GID_QUERY = `#graphql
  query BundlekitShopGid {
    shop {
      id
    }
  }
`;

const SET_METAFIELD_MUTATION = `#graphql
  mutation BundlekitSetOffersMetafield($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export class MetafieldSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetafieldSyncError";
  }
}

export async function fetchShopGid(admin: AdminGraphqlClient): Promise<string> {
  const response = await admin.graphql(SHOP_GID_QUERY);
  const body = (await response.json()) as { data?: { shop?: { id?: string } } };
  const gid = body.data?.shop?.id;
  if (!gid) throw new MetafieldSyncError("Could not resolve shop GID");
  return gid;
}

/**
 * Writes the full offers payload to the shop metafield. This REPLACES the
 * previous value atomically — pausing/deleting an offer and re-syncing
 * removes it from checkout evaluation in a single write.
 */
export async function writeOffersMetafield(
  admin: AdminGraphqlClient,
  shopGid: string,
  serializedOffers: unknown[],
): Promise<void> {
  const value = JSON.stringify({
    v: METAFIELD_PAYLOAD_VERSION,
    offers: serializedOffers,
  });

  const response = await admin.graphql(SET_METAFIELD_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: shopGid,
          namespace: METAFIELD_NAMESPACE,
          key: METAFIELD_KEY,
          type: "json",
          value,
        },
      ],
    },
  });

  const body = (await response.json()) as {
    data?: { metafieldsSet?: { userErrors?: Array<{ message: string }> } };
  };
  const errors = body.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    throw new MetafieldSyncError(
      `metafieldsSet failed: ${errors.map((e) => e.message).join("; ")}`,
    );
  }
}
