export interface RepositorySubcategory {
  id: string;
  parentId: string;
  name: string;
  icon: string;
}

/** Immutable pre-migration evidence, not a source of current membership. */
export interface RepositoryLegacyClassification {
  custom_category?: string;
  category_locked?: boolean;
  category_id?: string | null;
  subcategory_id?: string | null;
}

export interface RepositoryOrganization {
  subcategories: RepositorySubcategory[];
  subcategoryOrder: string[];
  repositoryOrder: number[];
}
