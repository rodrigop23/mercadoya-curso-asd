-- Solo la base aislada de rendimiento. No crea trabajos de sincronización Polar.
INSERT INTO product (id, title, description, price, stock, image_path)
SELECT md5('fitness-product-' || i)::uuid,
       (ARRAY['audífonos', 'laptop', 'teclado', 'mouse', 'monitor', 'cámara',
              'usb', 'cable', 'parlante', 'funda'])[1 + (i % 10)] || ' ' || i,
       'Producto sintético de la prueba de búsqueda',
       20 + (i % 100) * 5,
       10,
       '/uploads/perf-fixture.webp'
FROM generate_series(1, 1000) AS i
ON CONFLICT (id) DO NOTHING;
