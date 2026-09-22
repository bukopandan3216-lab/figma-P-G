import { supabase } from './supabase';
import type { Product } from '../data/products';

interface RecommendationProfile {
  concern?: string | null;
  skinType?: string | null;
  skinConcern?: string[];
  hairType?: string | null;
  hairConcern?: string[];
  bodyConcern?: string[];
  ageRange?: string | null;
  additionalConcern?: string | null;
  purchaseHistory?: Array<{ id?: string; category?: string; name?: string; tags?: string[] }>; 
}

function readLocalProfile(): RecommendationProfile {
  try {
    const raw = localStorage.getItem('pgbeauty-ai-profile');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readLocalHistory(): Array<{ id?: string; category?: string; name?: string; tags?: string[] }> {
  try {
    const raw = localStorage.getItem('pgbeauty-purchase-history');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function recommendProducts(customerId: string | null, products: Product[]) {
  const [{ data: profile }, { data: rules }] = await Promise.all([
    customerId ? supabase.from('profiles').select('skin_profile').eq('id', customerId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('recommendation_rules').select('rule_name, trigger_skin_type, target_category_id, weight_modifier').eq('is_active', true).order('weight_modifier', { ascending: false }),
  ]);

  const localProfile = readLocalProfile();
  const localHistory = readLocalHistory();
  const customer = {
    ...(profile?.skin_profile || {}),
    ...localProfile,
  } as RecommendationProfile;

  const activeRules = rules || [];
  const purchasedKeywords = localHistory.flatMap(item => [
    item.name || '',
    item.category || '',
    ...(item.tags || []),
  ]).filter(Boolean).map(value => value.toLowerCase());

  const scored = products.map(product => {
    let score = product.rating * 10;
    const reasons: string[] = [];
    const text = `${product.name} ${product.description} ${product.tags.join(' ')}`.toLowerCase();
    const productTerms = [product.name, product.category, product.brand, ...product.tags].map(value => String(value).toLowerCase());

    const profileValues = [
      customer.concern,
      customer.skinType,
      customer.hairType,
      customer.ageRange,
      ...(customer.skinConcern || []),
      ...(customer.hairConcern || []),
      ...(customer.bodyConcern || []),
      customer.additionalConcern,
    ].filter(Boolean).map(value => String(value).toLowerCase());

    if (productTerms.some(term => profileValues.some(value => term.includes(value)))) {
      score += 18;
      reasons.push('Matches your quiz profile');
    }

    if (customer.additionalConcern) {
      const additional = customer.additionalConcern.toLowerCase();
      if (text.includes(additional) || productTerms.some(term => term.includes(additional))) {
        score += 22;
        reasons.push('Matches your extra concern');
      }
    }

    if (purchasedKeywords.length) {
      const historyMatch = purchasedKeywords.some(keyword => text.includes(keyword) || productTerms.some(term => term.includes(keyword)));
      if (historyMatch) {
        score += 15;
        reasons.push('Similar to products you have bought before');
      }
    }

    for (const rule of activeRules as any[]) {
      const triggers = rule.trigger_skin_type || [];
      if (triggers.some((trigger: string) => profileValues.includes(trigger.toLowerCase()))) {
        score += Number(rule.weight_modifier) * 10;
        reasons.push('Matches your beauty profile');
      }
      if (rule.target_category_id && text.includes(String(rule.target_category_id).toLowerCase())) score += Number(rule.weight_modifier) * 5;
      if (product.stock > 0) score += Number(rule.weight_modifier);
    }

    if (product.rating >= 4.5) reasons.push('Highly rated by customers');
    if (product.stock > 0) reasons.push('Currently available');

    return {
      product,
      score,
      reason: reasons[0] || 'A strong match based on rating and availability',
    };
  }).sort((a, b) => b.score - a.score);

  return scored;
}
