export interface MediaStoragePort {
  store(input: { bytes: Uint8Array; contentType: string }): Promise<{ key: string }>;
}
