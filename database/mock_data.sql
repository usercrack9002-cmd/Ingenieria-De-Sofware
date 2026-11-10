USE invventas_licor;

-- ============================================================================
-- DATOS DE PRUEBA (Mock Data)
-- Compatible con el esquema corregido de invventas_licor
-- ============================================================================

-- Limpieza de datos existentes para permitir re-ejecución
SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM log_operaciones;
DELETE FROM anulaciones;
DELETE FROM eliminaciones_producto;
DELETE FROM desactivaciones_proveedor;
DELETE FROM movimientos_inventario;
DELETE FROM arqueo_denominaciones;
DELETE FROM arqueos_caja;
DELETE FROM gastos;
DELETE FROM venta_detalle;
DELETE FROM ventas;
DELETE FROM compra_detalle;
DELETE FROM compras;
DELETE FROM inventario;
DELETE FROM precios_agrupacion;
DELETE FROM producto_agrupaciones;
DELETE FROM productos;
DELETE FROM proveedores;
DELETE FROM usuarios;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- 0. Usuarios del sistema (necesario para todas las FK de usuario)
-- Contraseñas hasheadas con SHA2-256
-- ============================================================================
INSERT INTO usuarios (id_usuario, nombre_completo, usuario, contrasena, id_rol, id_sucursal, id_estado) VALUES
(1, 'Carmelo Torres', 'carmelo', '$2a$10$AKhnRu4h2P8wLsTW0Xhq/O/2M/8PMymQTUgeOdQD8raErq/nD29M2', 1, NULL, 1),
(2, 'Ana García', 'ana.garcia', '$2a$10$41nVv83lt5sBNGCkl9Z11OxifzaEGUeDqy9Av801QYHDElByr93ji', 3, 1, 1),
(3, 'Luis Mendoza', 'luis.mendoza', '$2a$10$AKhnRu4h2P8wLsTW0Xhq/O/2M/8PMymQTUgeOdQD8raErq/nD29M2', 2, 2, 1),
(4, 'María Rodríguez', 'maria.rodriguez', '$2a$10$41nVv83lt5sBNGCkl9Z11OxifzaEGUeDqy9Av801QYHDElByr93ji', 3, 2, 1),
(5, 'Pedro Sánchez', 'pedro.sanchez', '$2a$10$41nVv83lt5sBNGCkl9Z11OxifzaEGUeDqy9Av801QYHDElByr93ji', 3, 3, 1);

-- ============================================================================
-- 1. Proveedores
-- ============================================================================
INSERT INTO proveedores (id_proveedor, nombre, contacto, telefono, correo, id_sucursal, id_estado) VALUES
(1, 'Compañía Cervecera de Nicaragua', 'Juan Perez', '88887777', 'contacto@ccn.com.ni', 1, 1),
(2, 'Distribuidora Flor de Caña', 'Maria Lopez', '77776666', 'ventas@flordecana.com', 1, 1),
(3, 'DIAGEO Nicaragua', 'Carlos Gomez', '55554444', 'pedidos@diageo.com', 2, 1),
(4, 'Distribuidora El Sol (Snacks & Sodas)', 'Ana Martinez', '88881111', 'contacto@elsol.com', 3, 1);

-- ============================================================================
-- 2. Productos
-- id_categoria: 1=Licores, 2=Cervezas, 3=Vinos, 4=Cigarros, 5=Bebidas, 6=Snacks
-- ============================================================================
INSERT INTO productos (id_producto, nombre, id_categoria, precio_venta, id_estado) VALUES
(1,  'Ron Flor de Caña 12 Años 750ml',              1, 650.00,  1),
(2,  'Ron Flor de Caña 7 Años 750ml',               1, 350.00,  1),
(3,  'Cerveza Toña Botella 350ml',                   2, 45.00,   1),
(4,  'Cerveza Toña Lata 12oz',                       2, 50.00,   1),
(5,  'Whisky Johnnie Walker Black Label 750ml',      1, 1200.00, 1),
(6,  'Vino Casillero del Diablo Cabernet 750ml',     3, 480.00,  1),
(7,  'Cigarros Marlboro Rojo Cajilla',               4, 75.00,   1),
(8,  'Coca Cola Desechable 2 Litros',                5, 45.00,   1),
(9,  'Papas Lays Clásicas Familiares',               6, 60.00,   1),
(10, 'Vodka Absolut Blue 750ml',                     1, 550.00,  1);

-- ============================================================================
-- 3. Producto ↔ Agrupaciones (Equivalencia en unidades)
-- id_agrupacion: 1=Unidad, 2=Paquete, 3=Six Pack, 4=Caja, 5=Cajilla, 6=Botella, 7=Media Botella
-- ============================================================================
INSERT INTO producto_agrupaciones (id_producto, id_agrupacion, equivalencia_unidades) VALUES
-- Ron 12 Años: Unidad y Caja (12 botellas)
(1, 1, 1),   (1, 4, 12),
-- Ron 7 Años: Unidad y Caja (12 botellas)
(2, 1, 1),   (2, 4, 12),
-- Cerveza Toña Botella: Unidad, Six Pack (6), Caja (24)
(3, 1, 1),   (3, 3, 6),   (3, 4, 24),
-- Cerveza Toña Lata: Unidad, Six Pack (6), Caja (24)
(4, 1, 1),   (4, 3, 6),   (4, 4, 24),
-- Whisky JW: Unidad y Caja (12)
(5, 1, 1),   (5, 4, 12),
-- Vino Casillero: Unidad y Caja (12)
(6, 1, 1),   (6, 4, 12),
-- Marlboro: Unidad y Cajilla (cartón de 10)
(7, 1, 1),   (7, 5, 10),
-- Coca Cola: Unidad y Caja/Fardo (6)
(8, 1, 1),   (8, 4, 6),
-- Lays: Solo Unidad
(9, 1, 1),
-- Vodka Absolut: Unidad y Caja (12)
(10, 1, 1),  (10, 4, 12);

-- ============================================================================
-- 4. Precios por Agrupación (Venta por Mayor / Precios Especiales)
-- ============================================================================
INSERT INTO precios_agrupacion (id_producto, id_agrupacion, precio, descuento_porcentaje, activo) VALUES
-- Ron 12 Años Caja: 12×650=7800, con 5% desc → 7410
(1, 4, 7410.00, 5.00, 1),
-- Ron 7 Años Caja: 12×350=4200, con 5% desc → 3990
(2, 4, 3990.00, 5.00, 1),
-- Cerveza Toña Botella Six Pack: 6×45=270, con 5% desc → 256.50
(3, 3, 256.50, 5.00, 1),
-- Cerveza Toña Botella Caja: 24×45=1080, con 10% desc → 972
(3, 4, 972.00, 10.00, 1),
-- Cerveza Toña Lata Six Pack: 6×50=300, con 5% desc → 285
(4, 3, 285.00, 5.00, 1),
-- Cerveza Toña Lata Caja: 24×50=1200, con 10% desc → 1080
(4, 4, 1080.00, 10.00, 1);

-- ============================================================================
-- 5. Inventario (Stock Inicial por Sucursal y Ubicación)
-- ============================================================================
INSERT INTO inventario (id_producto, id_sucursal, ubicacion, stock, stock_minimo, lote, fecha_vencimiento, precio_costo) VALUES
-- ── Sucursal 1: Central ──
(1,  1, 'Bodega',     50,  5,  'L-R12-001', '2030-12-31', 450.00),
(1,  1, 'Mostrador',  12,  5,  'L-R12-001', '2030-12-31', 450.00),
(2,  1, 'Bodega',     80,  5,  'L-R07-002', '2030-12-31', 240.00),
(2,  1, 'Mostrador',  15,  5,  'L-R07-002', '2030-12-31', 240.00),
(3,  1, 'Bodega',     300, 10, 'L-CTB-102', '2026-12-31', 30.00),
(3,  1, 'Mostrador',  96,  10, 'L-CTB-102', '2026-12-31', 30.00),
(4,  1, 'Bodega',     200, 10, 'L-CTL-103', '2026-12-31', 34.00),
(4,  1, 'Mostrador',  48,  10, 'L-CTL-103', '2026-12-31', 34.00),
(5,  1, 'Bodega',     20,  2,  'L-WJW-004', '2031-12-31', 850.00),
(5,  1, 'Mostrador',  4,   2,  'L-WJW-004', '2031-12-31', 850.00),
(6,  1, 'Bodega',     40,  4,  'L-VCD-005', '2028-06-30', 320.00),
(6,  1, 'Mostrador',  8,   4,  'L-VCD-005', '2028-06-30', 320.00),
(7,  1, 'Bodega',     100, 10, 'L-CMM-006', '2027-09-30', 50.00),
(7,  1, 'Mostrador',  20,  10, 'L-CMM-006', '2027-09-30', 50.00),
(8,  1, 'Bodega',     120, 8,  'L-CC2-007', '2026-10-31', 33.00),
(8,  1, 'Mostrador',  24,  8,  'L-CC2-007', '2026-10-31', 33.00),
(9,  1, 'Bodega',     60,  5,  'L-PPL-008', '2026-09-30', 42.00),
(9,  1, 'Mostrador',  15,  5,  'L-PPL-008', '2026-09-30', 42.00),
(10, 1, 'Bodega',     30,  3,  'L-VAB-009', '2030-12-31', 380.00),
(10, 1, 'Mostrador',  6,   3,  'L-VAB-009', '2030-12-31', 380.00),

-- ── Sucursal 2: Plaza ──
(1, 2, 'Bodega',     20,  5,  'L-R12-001', '2030-12-31', 450.00),
(1, 2, 'Mostrador',  5,   5,  'L-R12-001', '2030-12-31', 450.00),
(3, 2, 'Bodega',     150, 10, 'L-CTB-102', '2026-12-31', 30.00),
(3, 2, 'Mostrador',  48,  10, 'L-CTB-102', '2026-12-31', 30.00),

-- ── Sucursal 3: Norte ──
(2, 3, 'Bodega',     30,  5,  'L-R07-002', '2030-12-31', 240.00),
(2, 3, 'Mostrador',  8,   5,  'L-R07-002', '2030-12-31', 240.00),
(4, 3, 'Bodega',     100, 10, 'L-CTL-103', '2026-12-31', 34.00),
(4, 3, 'Mostrador',  24,  10, 'L-CTL-103', '2026-12-31', 34.00);

-- ============================================================================
-- 6. Arqueos de Caja (últimos 7 días)
-- Usuario: Carmelo (id=1), Sucursal: Central (id=1)
-- ============================================================================
INSERT INTO arqueos_caja (id_arqueo, fecha, id_usuario, id_sucursal, efectivo_inicial, ventas_efectivo, gastos_aprobados, efectivo_esperado, efectivo_contado, diferencia, estado, observaciones) VALUES
(1, '2026-06-16', 1, 1, 1000.00, 3450.00, 200.00,  4250.00, 4250.00,  0.00,    'Cuadrada',   'Cierre sin novedad'),
(2, '2026-06-17', 1, 1, 1000.00, 4120.00, 150.00,  4970.00, 4970.00,  0.00,    'Cuadrada',   'Cierre sin novedad'),
(3, '2026-06-18', 1, 1, 1000.00, 2800.00, 0.00,    3800.00, 3780.00,  -20.00,  'Faltante',   'Faltaron C$20 por descuido en cambio'),
(4, '2026-06-19', 1, 1, 1000.00, 5600.00, 300.00,  6300.00, 6300.00,  0.00,    'Cuadrada',   'Cierre correcto'),
(5, '2026-06-20', 1, 1, 1000.00, 6800.00, 100.00,  7700.00, 7750.00,  50.00,   'Sobrante',   'Sobraron C$50 no reclamados'),
(6, '2026-06-21', 1, 1, 1000.00, 2100.00, 0.00,    3100.00, 3100.00,  0.00,    'Cuadrada',   'Cierre de domingo rápido'),
(7, '2026-06-22', 1, 1, 1000.00, 1500.00, 50.00,   2450.00, 0.00,     -2450.00,'Abierto',    'Caja en operación hoy');

-- ============================================================================
-- 7. Gastos (columnas correctas del esquema)
-- ============================================================================
INSERT INTO gastos (id_gasto, monto, motivo, id_usuario_solicitante, id_usuario_admin, id_sucursal, estado, fecha_resolucion) VALUES
(1, 200.00, 'Compra de hielo para cervezas',  1, 1, 1, 'Aprobado', '2026-06-16 18:00:00'),
(2, 150.00, 'Servicio de limpieza express',    1, 1, 1, 'Aprobado', '2026-06-17 18:00:00'),
(3, 300.00, 'Bolsas plásticas de empaque',     1, 1, 1, 'Aprobado', '2026-06-19 18:00:00'),
(4, 100.00, 'Botella de agua purificada',      1, 1, 1, 'Aprobado', '2026-06-20 18:00:00'),
(5,  50.00, 'Hielo y vasos desechables',       1, 1, 1, 'Aprobado', '2026-06-22 10:00:00');

-- ============================================================================
-- 8. Compras (Cabecera de facturas de abastecimiento)
-- ============================================================================
INSERT INTO compras (id_compra, numero_factura, fecha, id_proveedor, id_usuario, id_sucursal, metodo_pago, subtotal, iva_total, total, estado) VALUES
(1, 'FACT-CCN-9901', '2026-06-15', 1, 1, 1, 'Transferencia', 9000.00,  1350.00, 10350.00, 'Activa'),
(2, 'FACT-FDC-8812', '2026-06-18', 2, 1, 1, 'Tarjeta',       12000.00, 1800.00, 13800.00, 'Activa');

-- ============================================================================
-- 8.1 Detalle de Compras
-- Solo se insertan los campos de entrada; el TRIGGER calcula automáticamente:
--   iva_monto, subtotal_neto, cantidad_unidades,
--   precio_unitario_neto, precio_venta_sugerido
--
-- Fórmula del trigger:
--   subtotalBruto         = cantidad_agrupacion × precio_costo
--   baseDescuento         = subtotalBruto - descuento
--   ivaCalculado          = baseDescuento > 0 ? baseDescuento × (iva_porcentaje/100) : 0
--   totalNeto (subtotal_neto) = MAX(0, baseDescuento + ivaCalculado)
--   cantidadTotalRecibida = cantidad_unidades + bonificacion
--   precio_unitario_neto  = totalNeto / cantidadTotalRecibida
-- ============================================================================
INSERT INTO compra_detalle (id_compra, id_producto, id_agrupacion, cantidad_agrupacion, precio_costo, descuento, iva_porcentaje, bonificacion, lote, fecha_caducidad) VALUES
-- Compra 1 (Proveedor: CCN) — Cerveza Toña Botella
-- 12 cajas × C$720/caja, sin descuento, IVA 15%, sin bonificación
(1, 3, 4, 12, 720.00, 0.00, 15.00, 0, 'L-CTB-102', '2026-12-31'),
-- 12 unidades × C$30/unidad
(1, 3, 1, 12, 30.00,  0.00, 15.00, 0, 'L-CTB-102', '2026-12-31'),

-- Compra 2 (Proveedor: Flor de Caña) — Ron 12 Años y Ron 7 Años
-- 1 caja de Ron 12 × C$5400/caja
(2, 1, 4, 1,  5400.00, 0.00, 15.00, 0, 'L-R12-001', '2030-12-31'),
-- 8 unidades de Ron 12 × C$450/unidad
(2, 1, 1, 8,  450.00,  0.00, 15.00, 0, 'L-R12-001', '2030-12-31'),
-- 10 unidades de Ron 7 × C$300/unidad
(2, 2, 1, 10, 300.00,  0.00, 15.00, 0, 'L-R07-002', '2030-12-31');

-- ============================================================================
-- 9. Ventas (Cabecera)
-- ============================================================================
INSERT INTO ventas (id_venta, codigo_venta, fecha, id_usuario, id_sucursal, metodo_pago, subtotal, iva_total, total, estado) VALUES
-- Ventas del 16 al 22 de Junio 2026
(1, 'V-260616-001', '2026-06-16 14:30:00', 1, 1, 'Efectivo', 3000.00,  450.00,  3450.00, 'Completada'),
(2, 'V-260617-001', '2026-06-17 18:20:00', 1, 1, 'Efectivo', 3582.61,  537.39,  4120.00, 'Completada'),
(3, 'V-260618-001', '2026-06-18 19:40:00', 1, 1, 'Efectivo', 2434.78,  365.22,  2800.00, 'Completada'),
(4, 'V-260619-001', '2026-06-19 21:10:00', 1, 1, 'Efectivo', 4869.57,  730.43,  5600.00, 'Completada'),
(5, 'V-260620-001', '2026-06-20 23:05:00', 1, 1, 'Efectivo', 5913.04,  886.96,  6800.00, 'Completada'),
(6, 'V-260621-001', '2026-06-21 16:50:00', 1, 1, 'Efectivo', 1826.09,  273.91,  2100.00, 'Completada'),
(7, 'V-260622-001', '2026-06-22 10:15:00', 1, 1, 'Efectivo', 1304.35,  195.65,  1500.00, 'Completada');

-- ============================================================================
-- 9.1 Detalle de Ventas
-- ============================================================================
INSERT INTO venta_detalle (id_venta, id_producto, id_agrupacion, cantidad, precio_unitario, subtotal, iva, total, estado) VALUES
-- Venta 1 (16/Jun): Ron 12 ×3, Toña Lata SixPack ×2, Lays ×8
(1, 1, 1, 3, 650.00,  1950.00, 292.50,  2242.50, 'Vendido'),
(1, 4, 3, 2, 285.00,  570.00,  85.50,   655.50,  'Vendido'),
(1, 9, 1, 8, 60.00,   480.00,  72.00,   552.00,  'Vendido'),

-- Venta 2 (17/Jun): Ron 7 Caja ×1, Toña Botella Caja ×2
(2, 2, 4, 1, 3990.00, 3990.00, 598.50,  4588.50, 'Vendido'),
(2, 3, 4, 2, 972.00,  1944.00, 291.60,  2235.60, 'Vendido'),

-- Venta 3 (18/Jun): Whisky ×2, Coca Cola ×4
(3, 5, 1, 2, 1200.00, 2400.00, 360.00,  2760.00, 'Vendido'),
(3, 8, 1, 4, 45.00,   180.00,  27.00,   207.00,  'Vendido'),

-- Venta 4 (19/Jun): Ron 12 ×5, Marlboro ×10, Toña Lata Caja ×1
(4, 1, 1, 5, 650.00,  3250.00, 487.50,  3737.50, 'Vendido'),
(4, 7, 1, 10, 75.00,  750.00,  112.50,  862.50,  'Vendido'),
(4, 4, 4, 1, 1080.00, 1080.00, 162.00,  1242.00, 'Vendido'),

-- Venta 5 (20/Jun): Vodka ×4, Vino Caja ×1
(5, 10, 1, 4, 550.00,  2200.00, 330.00,  2530.00, 'Vendido'),
(5, 6,  4, 1, 4500.00, 4500.00, 675.00,  5175.00, 'Vendido'),

-- Venta 6 (21/Jun): Whisky ×1, Toña Botella SixPack ×2, Lays ×5
(6, 5, 1, 1, 1200.00, 1200.00, 180.00,  1380.00, 'Vendido'),
(6, 3, 3, 2, 256.50,  513.00,  76.95,   589.95,  'Vendido'),
(6, 9, 1, 5, 60.00,   300.00,  45.00,   345.00,  'Vendido'),

-- Venta 7 (22/Jun): Ron 7 ×2, Toña Lata SixPack ×2, Coca Cola ×5
(7, 2, 1, 2, 350.00,  700.00,  105.00,  805.00,  'Vendido'),
(7, 4, 3, 2, 285.00,  570.00,  85.50,   655.50,  'Vendido'),
(7, 8, 1, 5, 45.00,   225.00,  33.75,   258.75,  'Vendido');

-- ============================================================================
-- VERIFICACIÓN FINAL
-- ============================================================================
SELECT '✅ Datos de prueba insertados correctamente.' AS resultado;

-- Verificar campos calculados por el trigger en compra_detalle:
SELECT
    cd.id_compra_detalle,
    p.nombre AS producto,
    a.nombre AS agrupacion,
    cd.cantidad_agrupacion,
    cd.cantidad_unidades,
    cd.precio_costo,
    cd.descuento,
    cd.iva_porcentaje,
    cd.iva_monto,
    cd.bonificacion,
    cd.subtotal_neto,
    cd.precio_unitario_neto,
    cd.precio_venta_sugerido,
    p.precio_venta AS precio_venta_actual
FROM compra_detalle cd
    INNER JOIN productos p ON cd.id_producto = p.id_producto
    LEFT JOIN agrupaciones a ON cd.id_agrupacion = a.id_agrupacion
ORDER BY cd.id_compra_detalle;
