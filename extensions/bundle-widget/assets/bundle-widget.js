/**
 * BundleKit storefront widget — pure Web Component, zero framework.
 *
 * SEO GUARANTEE: this component NEVER renders <h1> or <h2>. Offer titles use
 * <h3> (or role="heading" aria-level="3"). Enforced by automated test.
 */
(function () {
  "use strict";

  var CACHE_TTL_MS = 60 * 1000; // sessionStorage cache, short TTL
  var PROXY_PATH = "/apps/bundlekit/offers";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(document.documentElement.lang || "en", {
        style: "currency",
        currency: currency || "USD",
      }).format(amount);
    } catch (e) {
      return (currency || "$") + " " + amount.toFixed(2);
    }
  }

  function tierUnitPrice(tier, basePrice) {
    if (tier.type === "pct") return basePrice * (1 - tier.value / 100);
    if (tier.type === "flat") return Math.max(0, basePrice - tier.value / 1);
    if (tier.type === "fixed_price") return tier.value;
    return basePrice;
  }

  function tierLabel(tier) {
    if (tier.type === "pct") return "Save " + tier.value + "%";
    if (tier.type === "flat") return "Save on this line";
    if (tier.type === "fixed_price") return "Special price";
    return "";
  }

  class BundleKitWidget extends HTMLElement {
    static get observedAttributes() {
      return ["product-id", "variant-id", "current-price", "currency", "block-type"];
    }

    connectedCallback() {
      this._selectedQty = null;
      this._render();
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (oldValue !== null && oldValue !== newValue && this.isConnected) {
        this._render();
      }
    }

    async _render() {
      var productId = this.getAttribute("product-id");
      if (!productId) return;

      var offers;
      try {
        offers = await this._getOffers(productId);
      } catch (e) {
        this.hidden = true;
        return;
      }

      var blockType = this.getAttribute("block-type") || "quantity-breaks";
      var wanted = {
        "quantity-breaks": "quantity_break",
        "progress-bar": "quantity_break",
        "bogo": "bogo",
        "free-gift": "free_gift"
      }[blockType];

      var matched = (offers || []).filter(function (o) {
        if (!o || o.type !== wanted || !o.config) return false;
        if (wanted === "quantity_break") return Array.isArray(o.config.tiers);
        return true;
      });

      if (!matched.length) {
        this.hidden = true;
        return;
      }

      this.hidden = false;
      var offer = matched[0]; // highest priority (API returns sorted)

      if (blockType === "progress-bar") {
        this.innerHTML = this._renderProgressBar(offer);
      } else if (blockType === "bogo") {
        this.innerHTML = this._renderBogo(offer);
      } else if (blockType === "free-gift") {
        this.innerHTML = this._renderFreeGift(offer);
      } else {
        this.innerHTML = this._renderQuantityBreaks(offer);
      }

      this._attachListeners();
    }

    _renderBogo(offer) {
      var config = offer.config;
      var pct = Number(config.discountPct || 100);
      var deal = pct >= 100 ? "free" : pct + "% off";
      var message =
        config.message ||
        "Buy " + Number(config.buyQty || 1) + ", get " +
        Number(config.getQty || 1) + " " + deal;
      return (
        '<div class="bk-widget bk-bogo" role="region" aria-label="Buy one get one offer">' +
        '<div class="bk-offer-label" role="heading" aria-level="3">' +
        escapeHtml(message) +
        "</div>" +
        '<p class="bk-note">Discount applies automatically at checkout.</p>' +
        "</div>"
      );
    }

    _renderFreeGift(offer) {
      var config = offer.config;
      var threshold = Number(config.threshold || 0);
      var cartTotal = parseFloat(this.getAttribute("cart-total") || "0") / 100;
      var currency = this._currency();
      var pct = Number(config.discountPct || 100);
      var dealWord = pct >= 100 ? "FREE" : pct + "% off";
      var remaining = Math.max(0, threshold - cartTotal);
      var progress = threshold > 0 ? Math.min(100, Math.round((cartTotal / threshold) * 100)) : 0;

      var message = remaining > 0
        ? "Spend " + formatMoney(remaining, currency) + " more to unlock your " + dealWord + " gift"
        : "Gift unlocked! Add it to your cart — it's " + dealWord + " at checkout";

      return (
        '<div class="bk-widget bk-progress" role="region" aria-label="Free gift offer">' +
        '<div class="bk-progress-label" role="heading" aria-level="3">' +
        escapeHtml(config.message ? config.message + " — " + message : message) +
        "</div>" +
        '<div class="bk-progress-track" role="progressbar" aria-valuenow="' + progress +
        '" aria-valuemin="0" aria-valuemax="100" aria-label="Progress toward free gift">' +
        '<div class="bk-progress-fill" style="width:' + progress + '%"></div>' +
        "</div>" +
        "</div>"
      );
    }

    _basePrice() {
      // Shopify liquid money is in minor units (cents)
      var cents = parseFloat(this.getAttribute("current-price") || "0");
      return isFinite(cents) ? cents / 100 : 0;
    }

    _currency() {
      return this.getAttribute("currency") || "USD";
    }

    _renderQuantityBreaks(offer) {
      var self = this;
      var base = this._basePrice();
      var currency = this._currency();
      var heading = this.getAttribute("heading") || offer.config.message || offer.title;

      var tiers = offer.config.tiers.slice().sort(function (a, b) {
        return a.qty - b.qty;
      });

      var items = tiers
        .map(function (tier) {
          var unit = tierUnitPrice(tier, base);
          var selected = self._selectedQty === tier.qty;
          return (
            '<button type="button" role="listitem" class="bk-tier' +
            (selected ? " bk-tier--active" : "") +
            '" data-qty="' + escapeHtml(tier.qty) + '" aria-pressed="' + selected + '">' +
            '<span class="bk-tier-qty">Buy ' + escapeHtml(tier.qty) + "+</span>" +
            '<span class="bk-tier-deal">' + escapeHtml(tierLabel(tier)) + "</span>" +
            '<span class="bk-tier-price">' + escapeHtml(formatMoney(unit, currency)) + " each</span>" +
            "</button>"
          );
        })
        .join("");

      return (
        '<div class="bk-widget" role="region" aria-label="Quantity discounts">' +
        '<h3 class="bk-offer-title">' + escapeHtml(heading) + "</h3>" +
        '<div class="bk-tiers" role="list">' + items + "</div>" +
        "</div>"
      );
    }

    _renderProgressBar(offer) {
      var qty = this._currentFormQty();
      var tiers = offer.config.tiers.slice().sort(function (a, b) {
        return a.qty - b.qty;
      });
      var next = null;
      for (var i = 0; i < tiers.length; i++) {
        if (qty < tiers[i].qty) { next = tiers[i]; break; }
      }

      var maxQty = tiers[tiers.length - 1].qty;
      var pct = Math.min(100, Math.round((qty / maxQty) * 100));
      var message = next
        ? "Add " + (next.qty - qty) + " more to unlock " + tierLabel(next).toLowerCase()
        : "Maximum discount unlocked!";

      return (
        '<div class="bk-widget bk-progress" role="region" aria-label="Discount progress">' +
        '<div class="bk-progress-label" role="heading" aria-level="3">' + escapeHtml(message) + "</div>" +
        '<div class="bk-progress-track" role="progressbar" aria-valuenow="' + pct +
        '" aria-valuemin="0" aria-valuemax="100" aria-label="Progress toward best discount">' +
        '<div class="bk-progress-fill" style="width:' + pct + '%"></div>' +
        "</div>" +
        "</div>"
      );
    }

    _attachListeners() {
      var self = this;
      this.querySelectorAll(".bk-tier").forEach(function (button) {
        button.addEventListener("click", function () {
          var qty = parseInt(button.getAttribute("data-qty"), 10);
          self._selectedQty = qty;
          self._setFormQuantity(qty);
          self._render();
        });
      });
    }

    _productForm() {
      return document.querySelector('form[action*="/cart/add"]');
    }

    _currentFormQty() {
      var form = this._productForm();
      var input = form && form.querySelector('input[name="quantity"]');
      var qty = input ? parseInt(input.value, 10) : 1;
      return isFinite(qty) && qty > 0 ? qty : 1;
    }

    _setFormQuantity(qty) {
      var form = this._productForm();
      var input = form && form.querySelector('input[name="quantity"]');
      if (input) {
        input.value = String(qty);
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    async _getOffers(productId) {
      var cacheKey = "bk_offers_" + productId;
      try {
        var cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          var entry = JSON.parse(cached);
          if (entry.t && Date.now() - entry.t < CACHE_TTL_MS) return entry.offers;
        }
      } catch (e) {
        /* sessionStorage unavailable — fall through to network */
      }

      var response = await fetch(
        PROXY_PATH + "?product_id=" + encodeURIComponent(productId),
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error("offers fetch failed");
      var data = await response.json();
      var offers = (data && data.offers) || [];

      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), offers: offers }));
      } catch (e) {
        /* ignore quota errors */
      }
      return offers;
    }
  }

  if (!customElements.get("bundlekit-widget")) {
    customElements.define("bundlekit-widget", BundleKitWidget);
  }
})();
