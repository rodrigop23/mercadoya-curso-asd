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

export interface CatalogContract {
  listProducts(): Promise<CatalogProduct[]>;
  createProduct(input: CreateProductInput): Promise<CatalogProduct>;
}
