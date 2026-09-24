export type ProductImage = {
  imagePath: string;
  thumbPath: string;
  imageUrl: string;
  thumbUrl: string;
};

export class InvalidMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMediaError';
  }
}

export interface MediaContract {
  processProductImage(file: File): Promise<ProductImage>;
  deleteProductImage(image: ProductImage): Promise<void>;
}
