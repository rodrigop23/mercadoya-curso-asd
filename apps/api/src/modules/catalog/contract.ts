export type CatalogProduct = {
  id: string;
  title: string;
  description: string;
  price: number;
  stock: number;
  imagePath: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateProductInput = {
  title: string;
  description: string;
  price: number;
  stock: number;
  image: File;
};

export type UpdateProductInput = Omit<CreateProductInput, 'image'> & { image?: File };

export type StockAdjustmentResult =
  | { adjusted: true; availableStock: number }
  | { adjusted: false; reason: 'product_not_found' | 'insufficient_stock' | 'stock_limit' };

export interface CatalogContract {
  listProducts(): Promise<CatalogProduct[]>;
  createProduct(input: CreateProductInput): Promise<CatalogProduct>;
  updateProduct(id: string, input: UpdateProductInput): Promise<CatalogProduct | null>;
  deleteProduct(id: string): Promise<boolean>;
  getAvailableStock(productId: string): Promise<number | null>;
  adjustStock(productId: string, delta: number): Promise<StockAdjustmentResult>;
}
