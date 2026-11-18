import { supabase } from './supabase';

export type SearchSuggestionSection = 'frequent' | 'top_selling';

export interface SearchSuggestion {
  section: SearchSuggestionSection;
  product_id: string;
  name: string;
  brand_name: string | null;
  image: string | null;
  tags: string[];
  score: number;
}

export async function fetchSearchSuggestions(limit = 5): Promise<SearchSuggestion[]> {
  const { data, error } = await supabase.rpc('get_search_suggestions', { p_limit: limit });
  if (error) throw error;
  return ((data || []) as SearchSuggestion[]).map(row => ({
    ...row,
    tags: Array.isArray(row.tags) ? row.tags : [],
    score: Number(row.score || 0),
  }));
}
