export interface StoreProductCard {
  id: string;
  slug: string;
  name: string;
  gender: string;
  category: { id: string; slug: string; label: string };
  price: number;
  compareAt: number | null;
  colours: { id: string; name: string; hex: string }[];
  sizes: string[];
  image: string | null;
  isNew: boolean;
  isBestseller: boolean;
  rating: number;
  sold: number;
  inStock: boolean;
}
