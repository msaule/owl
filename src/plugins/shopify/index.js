import { sleep } from '../../utils/time.js';
import { truncate } from '../../utils/text.js';

let pluginConfig = {
  shopDomain: '',
  accessToken: '',
  apiVersion: '2025-01',
  pollMinutes: 5,
  inventoryThreshold: 5
};

const state = {
  seenOrders: new Set(),
  inventoryByVariant: new Map()
};

async function shopifyFetch(endpoint) {
  const response = await fetch(
    `https://${pluginConfig.shopDomain}/admin/api/${pluginConfig.apiVersion}/${endpoint}`,
    {
      headers: {
        'x-shopify-access-token': pluginConfig.accessToken,
        'content-type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Shopify API failed with ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function buildOrderEvent(order) {
  return {
    id: `shopify-order-${order.id}`,
    source: 'shopify',
    type: 'order.placed',
    timestamp: order.created_at,
    summary: `New order from ${order.customer?.first_name || 'customer'}: ${order.name}`,
    data: {
      orderNumber: order.name,
      customer: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
      email: order.email || '',
      totalPrice: order.total_price,
      currency: order.currency,
      lineItems: (order.line_items || []).map((item) => `${item.title} x${item.quantity}`)
    },
    importance: 0.65
  };
}

function buildInventoryEvent(variant) {
  return {
    id: `shopify-inventory-${variant.id}-${variant.updated_at}`,
    source: 'shopify',
    type: 'inventory.low',
    timestamp: variant.updated_at || new Date().toISOString(),
    summary: `Low inventory for ${variant.product_title || variant.title}`,
    data: {
      title: variant.product_title || variant.title,
      sku: variant.sku,
      inventoryQuantity: variant.inventory_quantity
    },
    importance: 0.82
  };
}

export default {
  name: 'shopify',
  description: 'Watches Shopify orders and low inventory signals.',

  async setup(config = {}) {
    pluginConfig = { ...pluginConfig, ...config };
  },

  async *watch() {
    while (true) {
      const [ordersPayload, variantsPayload] = await Promise.all([
        shopifyFetch('orders.json?status=any&limit=25&order=created_at%20desc'),
        shopifyFetch('variants.json?limit=100')
      ]);

      for (const order of ordersPayload.orders || []) {
        if (state.seenOrders.has(order.id)) {
          continue;
        }
        state.seenOrders.add(order.id);
        yield buildOrderEvent(order);
      }

      for (const variant of variantsPayload.variants || []) {
        const previous = state.inventoryByVariant.get(variant.id);
        state.inventoryByVariant.set(variant.id, variant.inventory_quantity);

        if (
          variant.inventory_quantity != null &&
          variant.inventory_quantity <= (pluginConfig.inventoryThreshold || 5) &&
          previous !== variant.inventory_quantity
        ) {
          yield buildInventoryEvent(variant);
        }
      }

      await sleep((pluginConfig.pollMinutes || 5) * 60_000);
    }
  },

  async query(question) {
    return {
      plugin: 'shopify',
      status: pluginConfig.shopDomain ? 'connected' : 'not-configured',
      question: truncate(question, 160)
    };
  }
};
