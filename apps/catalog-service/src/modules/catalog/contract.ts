import type { StockAdjustmentResult } from '@mercadoya/contracts';
export type { StockAdjustmentResult } from '@mercadoya/contracts';

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

export interface CatalogContract {
  listProducts(): Promise<CatalogProduct[]>;
  createProduct(input: CreateProductInput): Promise<CatalogProduct>;
  updateProduct(id: string, input: UpdateProductInput): Promise<CatalogProduct | null>;
  deleteProduct(id: string): Promise<boolean>;
  getAvailableStock(productId: string): Promise<number | null>;
  adjustStock(productId: string, delta: number): Promise<StockAdjustmentResult>;
}
