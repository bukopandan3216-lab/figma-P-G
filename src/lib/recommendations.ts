import { supabase } from './supabase';
import type { Product } from '../data/products';

type InteractionType = 'view' | 'recommendation_shown' | 'recommendation_clicked' | 'cart' | 'wishlist' | 'purchase';

export interface ScoredRecommendation {
  recommendationId?: string;
  product: Product;
  score: number;
  reason: string;
}

function normalized(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function profileStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value.toLowerCase()];
  if (Array.isArray(value)) return value.flatMap(profileStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(profileStrings);
  return [];
}

export async function recordCustomerInteraction(
  userId: string | null | undefined,
  productId: string,
  interactionType: InteractionType,
  recommendationId?: string,
) {
  if (!userId) return;
  const { error } = await supabase.from('customer_product_interactions').insert({
    user_id: userId,
    product_id: productId,
    recommendation_id: recommendationId || null,
    interaction_type: interactionType,
  });
  if (error) throw error;
}

// A recommendation batch is expensive (7 queries) and every visit used to be
// logged 12x as "recommendation shown". Cache the result per customer and log
// a single shown event per batch, so the Insights counter reflects how many
// times recommendations were actually displayed.
const BATCH_TTL_MS = 10 * 60 * 1000;
const batchCache = new Map<string, { at: number; items: ScoredRecommendation[] }>();

export function clearRecommendationCache(customerId?: string) {
  if (customerId) batchCache.delete(customerId);
  else batchCache.clear();
}

export async function recommendProducts(customerId: string | null, products: Product[]): Promise<ScoredRecommendation[]> {
  if (customerId) {
    const cached = batchCache.get(customerId);
    if (cached && Date.now() - cached.at < BATCH_TTL_MS) return cached.items;
  }

  let profile: Record<string, unknown> = {};
  let rules: any[] = [];
  const productAffinity = new Map<string, number>();
  const reasonsByProduct = new Map<string, string[]>();

  if (customerId) {
    const [profileResult, rulesResult, interactionsResult, cartResult, wishlistResult, ordersResult, categoriesResult] = await Promise.all([
      supabase.from('profiles').select('skin_profile').eq('user_id', customerId).maybeSingle(),
      supabase.from('recommendation_rules').select('rule_name, trigger_skin_type, target_category_id, weight_modifier').eq('is_active', true),
      supabase.from('customer_product_interactions').select('product_id, interaction_type, created_at').eq('user_id', customerId),
      supabase.from('cart_items').select('product_id').eq('user_id', customerId),
      supabase.from('wishlist_items').select('product_id').eq('user_id', customerId),
      supabase.from('orders').select('order_items(variant_id)').eq('user_id', customerId),
      supabase.from('categories').select('category_id, name'),
    ]);
    const error = profileResult.error || rulesResult.error || interactionsResult.error || cartResult.error
      || wishlistResult.error || ordersResult.error || categoriesResult.error;
    if (error) throw error;
    profile = (profileResult.data?.skin_profile as Record<string, unknown>) || {};
    rules = rulesResult.data || [];

    for (const item of interactionsResult.data || []) {
      const weights: Record<InteractionType, number> = {
        view: 1,
        recommendation_shown: 0,
        recommendation_clicked: 4,
        cart: 3,
        wishlist: 3,
        purchase: 6,
      };
      productAffinity.set(item.product_id, (productAffinity.get(item.product_id) || 0) + weights[item.interaction_type as InteractionType]);
      if (item.interaction_type === 'recommendation_clicked') {
        const reasons = reasonsByProduct.get(item.product_id) || [];
        reasons.push('Previously opened from your recommendations');
        reasonsByProduct.set(item.product_id, reasons);
      }
    }
    for (const item of cartResult.data || []) productAffinity.set(item.product_id, (productAffinity.get(item.product_id) || 0) + 3);
    for (const item of wishlistResult.data || []) productAffinity.set(item.product_id, (productAffinity.get(item.product_id) || 0) + 3);

    const purchasedVariantIds = [...new Set((ordersResult.data || []).flatMap((order: any) => (order.order_items || []).map((item: any) => item.variant_id)).filter(Boolean))];
    if (purchasedVariantIds.length) {
      const { data: variants, error: variantsError } = await supabase.from('product_variants').select('variant_id, product_id').in('variant_id', purchasedVariantIds);
      if (variantsError) throw variantsError;
      for (const variant of variants || []) productAffinity.set(variant.product_id, (productAffinity.get(variant.product_id) || 0) + 6);
    }

    const categories = new Map((categoriesResult.data || []).map((category: any) => [category.category_id, normalized(category.name)]));
    const preferredCategories = profileStrings((profile as any).preferredCategories || (profile as any).preferred_categories || (profile as any).preferredProductCategories);
    const profileTerms = profileStrings(profile).filter(term => term.length > 2);

    const scored = products.map(product => {
      const productText = normalized(`${product.name} ${product.description} ${product.category} ${product.brand} ${(product.tags || []).join(' ')}`);
      const reasons = [...(reasonsByProduct.get(product.id) || [])];
      let score = Number(product.rating || 0);
      const affinity = productAffinity.get(product.id) || 0;
      if (affinity > 0) {
        score += affinity;
        reasons.push('Related to your cart, wishlist, purchases, or product activity');
      }
      const categoryMatch = preferredCategories.some(category => productText.includes(category));
      if (categoryMatch) {
        score += 12;
        reasons.push('Matches a preferred product category');
      }
      const matchedTerms = [...new Set(profileTerms.filter(term => productText.includes(term)))];
      if (matchedTerms.length) {
        score += Math.min(20, matchedTerms.length * 5);
        reasons.push('Matches your saved beauty preferences');
      }

      for (const rule of rules) {
        const triggerMatch = (rule.trigger_skin_type || []).some((trigger: string) => profileTerms.includes(normalized(trigger)));
        const targetCategory = categories.get(rule.target_category_id);
        const categoryRuleMatch = targetCategory && productText.includes(targetCategory);
        if (triggerMatch || categoryRuleMatch) {
          score += Number(rule.weight_modifier || 0) * (triggerMatch ? 5 : 3);
          reasons.push(rule.rule_name);
        }
      }

      if (product.stock <= 0) score = -1;
      return { product, score, reason: reasons[0] || 'Recommended from product ratings and Beauty product information' };
    }).sort((left, right) => right.score - left.score);

    const available = scored.filter(item => item.score >= 0).slice(0, 12);
    if (!available.length) return [];
    const { data: saved, error: saveError } = await supabase.from('recommendations').insert(available.map(item => ({
      user_id: customerId,
      product_id: item.product.id,
      score: item.score,
      reason: item.reason,
    }))).select('id:recommendation_id, product_id');
    if (saveError) throw saveError;

    const recommendationIds = new Map((saved || []).map((row: any) => [row.product_id, row.id]));
    // ONE shown event per batch (the top pick), not one per product.
    await recordCustomerInteraction(customerId, available[0].product.id, 'recommendation_shown', recommendationIds.get(available[0].product.id));

    const result = available.map(item => ({ ...item, recommendationId: recommendationIds.get(item.product.id) }));
    batchCache.set(customerId, { at: Date.now(), items: result });
    return result;
  }

  return products
    .map(product => ({ product, score: Number(product.rating || 0), reason: 'Recommended from product ratings and Beauty product information' }))
    .filter(item => item.product.stock > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);
}